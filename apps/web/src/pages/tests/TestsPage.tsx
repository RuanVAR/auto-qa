import { useState, useMemo } from 'react';
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
import { ListSearchSort } from '@/components/ui/ListSearchSort';

type TestRow = {
  id: string;
  name: string;
  description: string | null;
  type: string;
  tags: string[];
  steps: unknown[];
  version: number;
  updatedAt: string;
  isAiDraft?: boolean;
};

type TestSortKey = 'updated_desc' | 'name_asc' | 'name_desc' | 'steps_desc' | 'steps_asc' | 'version_desc';
const TEST_SORT_LABELS: Record<TestSortKey, string> = {
  updated_desc: 'Recently updated',
  name_asc: 'Name (A→Z)',
  name_desc: 'Name (Z→A)',
  steps_desc: 'Most steps',
  steps_asc: 'Fewest steps',
  version_desc: 'Highest version',
};

export function TestsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const qc = useQueryClient();
  const { user, orgRole } = useAuthStore();
  const canManage = orgRole === 'ORG_ADMIN' || user?.platformRole === 'PLATFORM_ADMIN';
  const { data: tests = [], isLoading } = useQuery({ queryKey: ['tests', projectId], queryFn: () => testsApi.list(projectId!), enabled: !!projectId });
  const duplicate = useMutation({ mutationFn: (id: string) => testsApi.duplicate(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['tests', projectId] }) });

  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<TestSortKey>('updated_desc');

  const visibleTests = useMemo(() => {
    const list = tests as TestRow[];
    const needle = search.trim().toLowerCase();
    const filtered = needle
      ? list.filter((t) =>
        t.name.toLowerCase().includes(needle) ||
        (t.description ?? '').toLowerCase().includes(needle) ||
        t.tags.some((tag) => tag.toLowerCase().includes(needle)),
      )
      : list;
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      switch (sort) {
        case 'name_asc': return a.name.localeCompare(b.name);
        case 'name_desc': return b.name.localeCompare(a.name);
        case 'steps_desc': return (b.steps?.length ?? 0) - (a.steps?.length ?? 0);
        case 'steps_asc': return (a.steps?.length ?? 0) - (b.steps?.length ?? 0);
        case 'version_desc': return (b.version ?? 0) - (a.version ?? 0);
        case 'updated_desc':
        default:
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      }
    });
    return sorted;
  }, [tests, search, sort]);

  if (isLoading) return <PageSpinner />;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Test Definitions</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {(tests as TestRow[]).length} test{(tests as TestRow[]).length !== 1 ? 's' : ''}
            {search && ` · ${visibleTests.length} match${visibleTests.length === 1 ? '' : 'es'}`}
          </p>
        </div>
        <div className="flex gap-2">
          {canManage && <Link to="/ai"><Button variant="secondary">✨ Generate with AI</Button></Link>}
          {canManage && <Link to={`/projects/${projectId}/tests/new/edit`}><Button><Plus size={14} /> New Test</Button></Link>}
        </div>
      </div>

      {(tests as TestRow[]).length > 0 && (
        <ListSearchSort
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search tests by name, description or tag…"
          sort={sort}
          onSortChange={setSort}
          sortOptions={TEST_SORT_LABELS}
        />
      )}

      <Card>
        {(tests as TestRow[]).length === 0 ? (
          <CardContent>
            <EmptyState icon={FlaskConical} title="No tests yet" description="Create a test or use AI to generate one." />
          </CardContent>
        ) : visibleTests.length === 0 ? (
          <CardContent>
            <div className="text-center py-6 text-sm text-gray-500">
              No tests match &ldquo;<span className="text-violet-500">{search}</span>&rdquo;.
              <button type="button" onClick={() => setSearch('')} className="ml-2 text-violet-500 hover:text-violet-600 underline">
                Clear search
              </button>
            </div>
          </CardContent>
        ) : (
          <Table>
            <Thead>
              <Tr>
                <Th>Name</Th>
                <Th>Tags</Th>
                <Th>Steps</Th>
                <Th>Version</Th>
                <Th>Updated</Th>
                {canManage && <Th>Actions</Th>}
              </Tr>
            </Thead>
            <Tbody>
              {visibleTests.map((t) => (
                <Tr key={t.id}>
                  <Td>
                    <div className="flex items-center gap-2">
                      <FlaskConical size={14} className="text-violet-400 shrink-0" />
                      <span className="font-medium text-gray-800">{t.name}</span>
                      {t.isAiDraft && <Badge variant="info">AI Draft</Badge>}
                    </div>
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {t.tags.map((tag) => <Badge key={tag} variant="muted">{tag}</Badge>)}
                    </div>
                  </Td>
                  <Td>{t.steps?.length ?? 0}</Td>
                  <Td><span className="text-gray-500">v{t.version}</span></Td>
                  <Td><span className="text-gray-400">{formatDate(t.updatedAt)}</span></Td>
                  {canManage && (
                    <Td>
                      <div className="flex items-center gap-1">
                        <Link to={`/projects/${projectId}/tests/${t.id}/edit`}>
                          <button className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
                            <Pencil size={13} />
                          </button>
                        </Link>
                        <button
                          onClick={() => duplicate.mutate(t.id)}
                          className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                        >
                          <Copy size={13} />
                        </button>
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
