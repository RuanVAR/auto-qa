import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Lock, CheckCircle, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { ssoApi } from '@/lib/api';
import { Button } from '@/components/ui/Button';

// ── Password input with show/hide toggle ────────────────────────────────────

function PasswordField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>
        {label}
      </label>
      <div className="relative">
        <Lock size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder ?? '••••••••'}
          className="w-full pl-9 pr-10"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.10)',
            borderRadius: '12px',
            color: 'var(--text-primary)',
            padding: '8px 36px 8px 36px',
            fontSize: '14px',
            outline: 'none',
          }}
        />
        <button
          type="button"
          onClick={() => setShow(s => !s)}
          className="absolute right-3 top-1/2 -translate-y-1/2"
          style={{ color: 'var(--text-muted)' }}
          tabIndex={-1}
        >
          {show ? <EyeOff size={13} /> : <Eye size={13} />}
        </button>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ChangePasswordSection() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [validationError, setValidationError] = useState('');
  const [success, setSuccess] = useState(false);

  const mutation = useMutation({
    mutationFn: () =>
      ssoApi.changePassword({ currentPassword: current, newPassword: next }),
    onSuccess: () => {
      setSuccess(true);
      setCurrent('');
      setNext('');
      setConfirm('');
    },
    onError: () => {
      setSuccess(false);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError('');
    setSuccess(false);

    if (next.length < 8) {
      setValidationError('New password must be at least 8 characters.');
      return;
    }
    if (next !== confirm) {
      setValidationError('Passwords do not match.');
      return;
    }

    mutation.mutate();
  };

  const apiError = mutation.isError
    ? ((mutation.error as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to change password.')
    : null;

  return (
    <div className="space-y-4" id="password">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Lock size={14} style={{ color: 'var(--text-muted)' }} />
        <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          Change Password
        </h3>
      </div>

      <div
        className="rounded-2xl p-5"
        style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.07)',
        }}
      >
        {/* Success message */}
        {success && (
          <div
            className="flex items-center gap-2 rounded-xl px-4 py-3 mb-4 text-sm"
            style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.25)', color: '#34d399' }}
          >
            <CheckCircle size={14} className="shrink-0" />
            Password changed successfully.
          </div>
        )}

        {/* Validation / API error */}
        {(validationError || apiError) && (
          <div
            className="flex items-start gap-2 rounded-xl px-4 py-3 mb-4 text-sm"
            style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171' }}
          >
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <span>{validationError || apiError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <PasswordField
            label="Current Password"
            value={current}
            onChange={setCurrent}
          />
          <PasswordField
            label="New Password"
            value={next}
            onChange={setNext}
            placeholder="min. 8 characters"
          />
          <PasswordField
            label="Confirm New Password"
            value={confirm}
            onChange={setConfirm}
          />

          <div className="pt-1">
            <Button
              type="submit"
              loading={mutation.isPending}
              disabled={!current || !next || !confirm}
            >
              Update Password
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
