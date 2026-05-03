import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, FlaskConical, Copy, Pencil } from 'lucide-react';
import { testsApi } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageSpinner } from '@/components/ui/Spinner';
import { Table, Thead, Tbody, Th, Td, Tr } from '@/components/ui/Table';
import { formatDate } from '@/lib/utils';

export function TestsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const qc = useQueryClient();
  const { user, orgRole } = useAuthStore();
  const canManage = orgRole === 'ORG_ADMIN' || user?.platformRole === 'PLATFORM_ADMIN';
  const { data: tests = [], isLoading } = useQuery({ queryKey: ['tests', projectId], queryFn: () => testsApi.list(projectId!), enabled: !!projectId });
  const duplicate = useMutation({ mutationFn: (id: string) => testsApi.duplicate(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['tests', projectId] }) });
  if (isLoading) return <PageSpinner />;
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div><h2 className="text-xl font-bold text-gray-900">Test Definitions</h2><p className="text-sm text-gray-500 mt-0.5">{tests.length} test{tests.length !== 1 ? 's' : ''}</p></div>
        <div className="flex gap-2">
          {canManage && <Link to="/ai"><Button variant="secondary">✨ Generate with AI</Button></Link>}
          {canManage && <Link to={`/projects/${projectId}/tests/new/edit`}><Button><Plus size={14} /> New Test</Button></Link>}
        </div>
      </div>
      <Card>
        {tests.length === 0 ? <CardContent><EmptyState icon={FlaskConical} title="No tests yet" description="Create a test or use AI to generate one." /></CardContent> : (
          <Table>
            <Thead><Tr><Th>Name</Th><Th>Tags</Th><Th>Steps</Th><Th>Version</Th><Th>Updated</Th>{canManage && <Th>Actions</Th>}</Tr></Thead>
            <Tbody>
              {tests.map((t: Record<string,unknown>) => (
                <Tr key={t.id as string}>
                  <Td><div className="flex items-center gap-2"><FlaskConical size={14} className="text-violet-400 shrink-0" /><span className="font-medium text-gray-800">{t.name as string}</span>{!!(t.isAiDraft) && <Badge variant="info">AI Draft</Badge>}</div></Td>
                  <Td><div className="flex flex-wrap gap-1">{(t.tags as string[]).map(tag => <Badge key={tag} variant="muted">{tag}</Badge>)}</div></Td>
                  <Td>{(t.steps as unknown[]).length}</Td>
                  <Td><span className="text-gray-500">v{t.version as number}</span></Td>
                  <Td><span className="text-gray-400">{formatDate(t.updatedAt as string)}</span></Td>
                  {canManage && (
                    <Td>
                      <div className="flex items-center gap-1">
                        <Link to={`/projects/${projectId}/tests/${t.id}/edit`}><button className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"><Pencil size={13} /></button></Link>
                        <button onClick={() => duplicate.mutate(t.id as string)} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"><Copy size={13} /></button>
                      </div>
                    </Td>
                  )}
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
