import { Injectable, NotFoundException, UnauthorizedException, Logger } from '@nestjs/common';
import { randomUUID, randomBytes } from 'crypto';

/**
 * Test-recorder pairing service.
 *
 * A recording session is a short-lived pairing between two clients:
 *   - the **viewer** (the user's RecorderPage in the web app), authenticated by JWT
 *   - the **recorder** (the Chrome extension running on the user's machine),
 *     authenticated by a short code displayed in the web app and typed into
 *     the extension.
 *
 * Sessions live in memory (no DB) — they're ephemeral (default 30-min TTL)
 * and re-creating them on restart is cheap. A periodic sweep prunes expired
 * sessions.
 */
export interface RecorderSession {
  id: string;
  code: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
  viewerSocketId?: string;
  recorderSocketId?: string;
}

const SESSION_TTL_MS = 30 * 60 * 1000;
const CODE_LEN = 6; // 6 chars from a 32-symbol alphabet → ~30 bits

// Alphabet excludes look-alikes (0/O, 1/I/L) so users typing the code don't
// get tripped up by the font in their extension popup.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateCode(): string {
  const bytes = randomBytes(CODE_LEN);
  let out = '';
  for (let i = 0; i < CODE_LEN; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
}

/**
 * Listener interface: the gateway implements this to know when sessions are
 * destroyed so it can disconnect any sockets bound to them. We use this
 * indirection (instead of injecting the gateway directly) to avoid a circular
 * import — the gateway already depends on this service.
 */
export interface SessionLifecycleListener {
  onSessionDestroyed(session: RecorderSession, reason: 'replaced' | 'expired' | 'manual'): void;
}

@Injectable()
export class RecorderService {
  private readonly logger = new Logger(RecorderService.name);
  private readonly sessions = new Map<string, RecorderSession>();
  private readonly byCode = new Map<string, string>(); // code → sessionId
  private listeners = new Set<SessionLifecycleListener>();

  constructor() {
    // Sweep expired sessions every minute. Cheap — sessions map is tiny.
    setInterval(() => this.sweep(), 60_000).unref();
  }

  registerListener(l: SessionLifecycleListener): void { this.listeners.add(l); }

  createSession(userId: string): RecorderSession {
    // Invalidate any sessions this user already owns — otherwise an
    // extension paired to the previous session would keep emitting steps
    // into a viewer that's already gone (the orphan-session bug). Each
    // user has at most ONE active session.
    for (const s of this.sessions.values()) {
      if (s.userId === userId) {
        this.logger.log(`Replacing prior session ${s.id} for user ${userId}`);
        this.destroy(s.id, 'replaced');
      }
    }

    // Regenerate on collision (vanishingly unlikely but cheap to guard).
    let code: string;
    do {
      code = generateCode();
    } while (this.byCode.has(code));

    const now = new Date();
    const session: RecorderSession = {
      id: randomUUID(),
      code,
      userId,
      createdAt: now,
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    };
    this.sessions.set(session.id, session);
    this.byCode.set(session.code, session.id);
    this.logger.log(`Created recorder session ${session.id} (code=${code}) for user ${userId}`);
    return session;
  }

  /** Destroy a session and notify listeners so attached sockets disconnect. */
  destroy(id: string, reason: 'replaced' | 'expired' | 'manual' = 'manual'): void {
    const s = this.sessions.get(id);
    if (!s) return;
    this.sessions.delete(id);
    this.byCode.delete(s.code);
    for (const l of this.listeners) {
      try { l.onSessionDestroyed(s, reason); } catch {}
    }
  }

  getById(id: string): RecorderSession | undefined {
    const s = this.sessions.get(id);
    if (s && s.expiresAt.getTime() < Date.now()) {
      this.delete(s.id);
      return undefined;
    }
    return s;
  }

  getByCode(code: string): RecorderSession | undefined {
    const id = this.byCode.get(code.toUpperCase());
    if (!id) return undefined;
    return this.getById(id);
  }

  /** Attach the platform RecorderPage (viewer) to a session it owns. */
  attachViewer(sessionId: string, userId: string, socketId: string): RecorderSession {
    const s = this.getById(sessionId);
    if (!s) throw new NotFoundException('Recorder session not found or expired');
    if (s.userId !== userId) {
      throw new UnauthorizedException('Session belongs to another user');
    }
    s.viewerSocketId = socketId;
    return s;
  }

  /** Attach the Chrome extension (recorder) to a session via its short code. */
  attachRecorder(code: string, socketId: string): RecorderSession {
    const s = this.getByCode(code);
    if (!s) throw new NotFoundException('Invalid or expired session code');
    s.recorderSocketId = socketId;
    return s;
  }

  detach(socketId: string): RecorderSession | undefined {
    for (const s of this.sessions.values()) {
      if (s.viewerSocketId === socketId) {
        s.viewerSocketId = undefined;
        return s;
      }
      if (s.recorderSocketId === socketId) {
        s.recorderSocketId = undefined;
        return s;
      }
    }
    return undefined;
  }

  delete(id: string): void { this.destroy(id, 'manual'); }

  private sweep(): void {
    const now = Date.now();
    for (const [id, s] of this.sessions) {
      if (s.expiresAt.getTime() < now) this.destroy(id, 'expired');
    }
  }
}
