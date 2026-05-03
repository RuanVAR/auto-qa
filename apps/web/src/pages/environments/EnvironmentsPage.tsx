import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Globe } from 'lucide-react';
import { environmentsApi } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageSpinner } from '@/components/ui/Spinner';
import { Table, Thead, Tbody, Th, Td, Tr } from '@/components/ui/Table';

const ENV_TYPES = ['LOCAL','STAGING','PRODUCTION','INTERNAL','CUSTOM'];

export function EnvironmentsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState('STAGING');
  const [baseUrl, setBaseUrl] = useState('');
  const [desc, setDesc] = useState('');
  const [embedAllowed, setEmbedAllowed] = useState(true);

  const { data: envs = [], isLoading } = useQuery({
    queryKey: ['environments', projectId],
    queryFn: () => environmentsApi.list(projectId!),
    enabled: !!projectId,
  });

  const create = useMutation({
    mutationFn: () => environmentsApi.create(projectId!, { name, type, baseUrl, description: desc, embedAllowed }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['environments', projectId] });
      setOpen(false);
      setName('');
      setBaseUrl('');
      setDesc('');
      setEmbedAllowed(true);
    },
  });

  if (isLoading) return <PageSpinner />;

  const typeVariant = (t: string) =>
    ({ LOCAL: 'muted', STAGING: 'info', PRODUCTION: 'warning', INTERNAL: 'default', CUSTOM: 'muted' } as Record<string, 'muted' | 'info' | 'warning' | 'default'>)[t] ?? 'default';

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Environments</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {(envs as unknown[]).length} environment{(envs as unknown[]).length !== 1 ? 's' : ''}
          </p>
        </div>
        <Button onClick={() => setOpen(true)}><Plus size={14} /> New Environment</Button>
      </div>

      <Card>
        {(envs as unknown[]).length === 0 ? (
          <CardContent>
            <EmptyState
              icon={Globe}
              title="No environments yet"
              description="Add an environment to run tests against. The Base URL is used by automated and manual tests."
              action={<Button onClick={() => setOpen(true)}><Plus size={14} /> Add</Button>}
            />
          </CardContent>
        ) : (
          <Table>
            <Thead>
              <Tr>
                <Th>Name</Th>
                <Th>Type</Th>
                <Th>Base URL</Th>
                <Th>Iframe</Th>
                <Th>Description</Th>
              </Tr>
            </Thead>
            <Tbody>
              {(envs as Record<string, unknown>[]).map(e => (
                <Tr key={e.id as string}>
                  <Td><span className="font-medium text-gray-800">{e.name as string}</span></Td>
                  <Td><Badge variant={typeVariant(e.type as string)}>{e.type as string}</Badge></Td>
                  <Td><span className="font-mono text-xs text-gray-500">{e.baseUrl as string}</span></Td>
                  <Td>
                    {e.embedAllowed
                      ? <Badge variant="default">Embedded</Badge>
                      : <Badge variant="muted">New tab</Badge>}
                  </Td>
                  <Td><span className="text-gray-400 text-xs">{(e.description as string) ?? '—'}</span></Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="New Environment">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Name</label>
            <input
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              placeholder="Staging"
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Type</label>
            <select
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              value={type}
              onChange={e => setType(e.target.value)}
            >
              {ENV_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Base URL</label>
            <input
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sky-500"
              placeholder="https://staging.example.com"
              value={baseUrl}
              onChange={e => setBaseUrl(e.target.value)}
            />
            <p className="text-xs text-gray-400 mt-1">
              Used as the target URL for all automated runs and manual test previews against this environment.
            </p>
          </div>
          <div className="flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
            <input
              id="embedAllowed"
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-sky-600 focus:ring-sky-500"
              checked={embedAllowed}
              onChange={e => setEmbedAllowed(e.target.checked)}
            />
            <label htmlFor="embedAllowed" className="text-sm text-gray-700 cursor-pointer">
              <span className="font-medium">Allow iframe embedding</span>
              <span className="block text-xs text-gray-500 mt-0.5">
                Enable if the app allows embedding (no <code className="font-mono">X-Frame-Options: DENY</code>).
                Disable to open the app in a new tab during manual testing instead.
              </span>
            </label>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Description <span className="font-normal text-gray-400">(optional)</span></label>
            <input
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              placeholder="e.g. Shared staging server, resets nightly"
              value={desc}
              onChange={e => setDesc(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button loading={create.isPending} disabled={!name || !baseUrl} onClick={() => create.mutate()}>Add Environment</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
