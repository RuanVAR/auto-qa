import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { RecorderService, type SessionLifecycleListener, type RecorderSession } from './recorder.service';
import type { JwtPayload } from '../../common/decorators/current-user.decorator';

/**
 * Real-time relay for the QA test-recorder Chrome extension.
 *
 *   Viewer (RecorderPage in web app)  ──┐
 *                                       ├──→  /recorder namespace (this gateway)
 *   Recorder (Chrome extension)       ──┘                │
 *                                                        ▼
 *                                                 RecorderService
 *                                                 (pairs them via sessionId)
 *
 * Messages flow recorder → server → viewer. The viewer's only outbound
 * message is a "control" event (pause / resume) which goes recorder-ward.
 *
 * Auth model:
 *   - Viewer joins with `auth.token` (JWT) and the sessionId it owns.
 *   - Recorder joins with the 6-char session code (shown in the web UI,
 *     typed into the extension). The code is the only auth — it's short
 *     lived (30 min) and only the user knows it.
 */
@WebSocketGateway(3002, {
  cors: { origin: '*', credentials: false },
  namespace: '/recorder',
})
export class RecorderGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, SessionLifecycleListener
{
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(RecorderGateway.name);

  constructor(
    private readonly sessions: RecorderService,
    private readonly jwt: JwtService,
  ) {}

  onModuleInit() {
    // Subscribe to session-lifecycle events so we can disconnect any sockets
    // bound to a destroyed session — the orphan-session fix.
    this.sessions.registerListener(this);
  }

  onSessionDestroyed(session: RecorderSession, reason: 'replaced' | 'expired' | 'manual'): void {
    // Tell both peers (if present) that the session is over, then disconnect
    // their sockets so they fall back to a clean "disconnected" state.
    const payload = { sessionId: session.id, reason };
    if (session.viewerSocketId) {
      this.server.to(session.viewerSocketId).emit('session:expired', payload);
      // Use the namespace-aware disconnectSockets — works across socket.io
      // 4.x without depending on the private sockets Map type.
      this.server.in(session.viewerSocketId).disconnectSockets(true);
    }
    if (session.recorderSocketId) {
      this.server.to(session.recorderSocketId).emit('session:expired', payload);
      this.server.in(session.recorderSocketId).disconnectSockets(true);
    }
    this.logger.log(`Session ${session.id} destroyed (${reason}); kicked attached sockets`);
  }

  handleConnection(client: Socket) {
    this.logger.log(`Recorder ns connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    const session = this.sessions.detach(client.id);
    if (!session) return;
    // Notify the other party (if still connected) that their peer dropped.
    if (session.viewerSocketId && session.viewerSocketId !== client.id) {
      this.server.to(session.viewerSocketId).emit('peer:disconnected', { role: 'recorder' });
    }
    if (session.recorderSocketId && session.recorderSocketId !== client.id) {
      this.server.to(session.recorderSocketId).emit('peer:disconnected', { role: 'viewer' });
    }
    this.logger.log(`Recorder ns detached: ${client.id} (session ${session.id})`);
  }

  /** Viewer (web app) joins a session it owns. JWT-authenticated. */
  @SubscribeMessage('viewer:join')
  handleViewerJoin(
    @MessageBody() body: { sessionId: string; token: string },
    @ConnectedSocket() client: Socket,
  ) {
    this.logger.log(`viewer:join received — sessionId=${body?.sessionId} hasToken=${!!body?.token}`);
    try {
      if (!body?.token) throw new Error('No token provided');
      if (!body?.sessionId) throw new Error('No sessionId provided');
      const payload = this.jwt.verify<JwtPayload>(body.token);
      this.logger.log(`viewer:join token verified for user ${payload.sub}`);
      const session = this.sessions.attachViewer(body.sessionId, payload.sub, client.id);
      client.data.role = 'viewer';
      client.data.sessionId = session.id;
      this.logger.log(`Viewer joined session ${session.id}`);
      // If the recorder is already waiting, signal them to start streaming.
      if (session.recorderSocketId) {
        this.server.to(session.recorderSocketId).emit('peer:connected', { role: 'viewer' });
        client.emit('peer:connected', { role: 'recorder' });
      }
      client.emit('viewer:joined', { sessionId: session.id, code: session.code });
    } catch (e) {
      const msg = (e as Error).message;
      this.logger.error(`viewer:join failed: ${msg}`);
      client.emit('error', { message: msg });
      client.disconnect(true);
    }
  }

  /** Recorder (Chrome extension) joins a session by typing the user-visible code. */
  @SubscribeMessage('recorder:join')
  handleRecorderJoin(
    @MessageBody() body: { code: string },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const session = this.sessions.attachRecorder(body.code, client.id);
      client.data.role = 'recorder';
      client.data.sessionId = session.id;
      this.logger.log(`Recorder joined session ${session.id} (code=${body.code})`);
      if (session.viewerSocketId) {
        this.server.to(session.viewerSocketId).emit('peer:connected', { role: 'recorder' });
        client.emit('peer:connected', { role: 'viewer' });
      }
      client.emit('recorder:joined', { sessionId: session.id });
    } catch (e) {
      client.emit('error', { message: (e as Error).message });
      client.disconnect(true);
    }
  }

  /** Recorder forwards a captured step to its paired viewer. */
  @SubscribeMessage('step')
  handleStep(
    @MessageBody() body: { step: unknown },
    @ConnectedSocket() client: Socket,
  ) {
    if (client.data.role !== 'recorder' || !client.data.sessionId) {
      this.logger.warn(`step rejected: role=${client.data.role} sessionId=${client.data.sessionId}`);
      return;
    }
    const session = this.sessions.getById(client.data.sessionId);
    if (!session?.viewerSocketId) {
      this.logger.warn(`step dropped: no viewer paired for session ${client.data.sessionId}`);
      return;
    }
    const step = body?.step as { type?: string } | undefined;
    this.logger.log(`step ${step?.type ?? '?'} → viewer ${session.viewerSocketId}`);
    this.server.to(session.viewerSocketId).emit('step', body);
  }

  /** Viewer sends a control message (pause/resume) to the paired recorder. */
  @SubscribeMessage('control')
  handleControl(
    @MessageBody() body: { action: 'pause' | 'resume' | 'stop' },
    @ConnectedSocket() client: Socket,
  ) {
    if (client.data.role !== 'viewer' || !client.data.sessionId) return;
    const session = this.sessions.getById(client.data.sessionId);
    if (!session?.recorderSocketId) return;
    this.server.to(session.recorderSocketId).emit('control', body);
  }

  /**
   * Viewer asks "does this selector resolve on the target page?". Forwards
   * the request to the recorder (extension), which runs the query in the
   * content script and replies via `selector:test:result`. Used by the test
   * editor's "Test selector" button so users can validate selectors before
   * a full Playwright replay.
   */
  @SubscribeMessage('selector:test')
  handleSelectorTest(
    @MessageBody() body: { selector: string; reqId: string },
    @ConnectedSocket() client: Socket,
  ) {
    if (client.data.role !== 'viewer' || !client.data.sessionId) return;
    const session = this.sessions.getById(client.data.sessionId);
    if (!session?.recorderSocketId) return;
    this.server.to(session.recorderSocketId).emit('selector:test', body);
  }

  /** Recorder reports back the result of a selector test to the viewer. */
  @SubscribeMessage('selector:test:result')
  handleSelectorTestResult(
    @MessageBody() body: {
      reqId: string;
      count: number;
      samples?: Array<{ tagName: string; text: string; outerHtml: string }>;
      url?: string;
      error?: string;
    },
    @ConnectedSocket() client: Socket,
  ) {
    if (client.data.role !== 'recorder' || !client.data.sessionId) return;
    const session = this.sessions.getById(client.data.sessionId);
    if (!session?.viewerSocketId) return;
    this.server.to(session.viewerSocketId).emit('selector:test:result', body);
  }
}
