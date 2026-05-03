/**
 * StepFailurePanel
 * ----------------
 * Shown at the bottom of RunDetailPage when a step:failed WebSocket event fires
 * (or when the run has a FAILED status and has failed steps).
 *
 * Provides 6 actions:
 *   1. Add Comment          – adds notes to the step (always enabled)
 *   2. Skip Step            – marks step SKIPPED and continues run (always enabled)
 *   3. Skip Test            – marks run CANCELLED (always enabled)
 *   4. Retry Step           – resets step to PENDING for re-execution (always enabled)
 *   5. Create Jira Ticket   – disabled + badge if JIRA_URL not in platform config
 *   6. Notify Slack/Teams   – disabled + badge if SLACK_WEBHOOK_URL not in platform config
 */

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  MessageSquare,
  SkipForward,
  XOctagon,
  RefreshCw,
  ExternalLink,
  Bell,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { runsApi, adminApi } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

interface FailedStep {
  id: string;
  index: number;
  name: string;
  errorMessage?: string | null;
}

interface Props {
  runId: string;
  step: FailedStep;
  onActionComplete?: () => void;
}

// ── helpers ────────────────────────────────────────────────────────────────────

function RequiresSetup() {
  return (
    <Badge variant="muted" className="text-[10px] px-1.5 py-0 ml-1">
      Requires setup
    </Badge>
  );
}

// ── component ──────────────────────────────────────────────────────────────────

export function StepFailurePanel({ runId, step, onActionComplete }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [showNoteBox, setShowNoteBox] = useState(false);

  // Check which integrations are configured
  const { data: configList = [] } = useQuery({
    queryKey: ['platform-config'],
    queryFn: () => adminApi.listConfig(),
    staleTime: 60_000,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cfgMap = Object.fromEntries((configList as any[]).map((c: { key: string }) => [c.key, true]));
  const jiraEnabled = !!cfgMap['JIRA_URL'];
  const slackEnabled = !!cfgMap['SLACK_WEBHOOK_URL'];

  // Mutations
  const skipStep = useMutation({
    mutationFn: () => runsApi.skipStep(runId, step.id),
    onSuccess: () => onActionComplete?.(),
  });
  const retryStep = useMutation({
    mutationFn: () => runsApi.retryStep(runId, step.id),
    onSuccess: () => onActionComplete?.(),
  });
  const skipTest = useMutation({
    mutationFn: () => runsApi.cancel(runId),
    onSuccess: () => onActionComplete?.(),
  });
  const addComment = useMutation({
    mutationFn: () => runsApi.patchStep(runId, step.id, { notes: noteText }),
    onSuccess: () => { setNoteText(''); setShowNoteBox(false); onActionComplete?.(); },
  });

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="w-full flex items-center gap-2 px-4 py-2.5 bg-red-900/20 border border-red-800/50 rounded-xl text-sm text-red-400 hover:bg-red-900/30 transition-colors"
      >
        <AlertTriangle size={13} />
        <span className="font-medium">Step failed: {step.name}</span>
        <span className="ml-auto"><ChevronDown size={14} /></span>
      </button>
    );
  }

  return (
    <div className="border border-red-800/60 rounded-xl bg-red-950/20 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 bg-red-900/30 border-b border-red-800/40">
        <AlertTriangle size={14} className="text-red-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-red-200">Step failed: {step.name}</p>
          {step.errorMessage && (
            <p className="text-xs text-red-400 mt-0.5 font-mono truncate">{step.errorMessage}</p>
          )}
        </div>
        <button
          onClick={() => setCollapsed(true)}
          className="p-1 text-red-400 hover:text-red-200"
        >
          <ChevronUp size={14} />
        </button>
      </div>

      {/* Actions */}
      <div className="p-4 space-y-3">
        <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-2">
          Recovery Actions
        </p>
        <div className="flex flex-wrap gap-2">
          {/* 1. Add Comment */}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowNoteBox((v) => !v)}
          >
            <MessageSquare size={13} />
            Add Comment
          </Button>

          {/* 2. Skip Step */}
          <Button
            variant="secondary"
            size="sm"
            loading={skipStep.isPending}
            onClick={() => skipStep.mutate()}
          >
            <SkipForward size={13} />
            Skip Step
          </Button>

          {/* 3. Skip Test (cancel run) */}
          <Button
            variant="secondary"
            size="sm"
            loading={skipTest.isPending}
            onClick={() => skipTest.mutate()}
          >
            <XOctagon size={13} />
            Abort Run
          </Button>

          {/* 4. Retry Step */}
          <Button
            variant="secondary"
            size="sm"
            loading={retryStep.isPending}
            onClick={() => retryStep.mutate()}
          >
            <RefreshCw size={13} />
            Retry Step
          </Button>

          {/* 5. Create Jira Ticket */}
          <Button
            variant="secondary"
            size="sm"
            disabled={!jiraEnabled}
          >
            <ExternalLink size={13} />
            Create Jira Ticket
            {!jiraEnabled && <RequiresSetup />}
          </Button>

          {/* 6. Notify Slack/Teams */}
          <Button
            variant="secondary"
            size="sm"
            disabled={!slackEnabled}
          >
            <Bell size={13} />
            Notify Slack/Teams
            {!slackEnabled && <RequiresSetup />}
          </Button>
        </div>

        {/* Inline note box */}
        {showNoteBox && (
          <div className="mt-3 space-y-2">
            <textarea
              className="w-full rounded-lg border border-gray-700 bg-gray-900 text-gray-100 text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-500 resize-none"
              rows={3}
              placeholder="Add a note about this failure…"
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                loading={addComment.isPending}
                disabled={!noteText.trim()}
                onClick={() => addComment.mutate()}
              >
                Save Note
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => { setShowNoteBox(false); setNoteText(''); }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
