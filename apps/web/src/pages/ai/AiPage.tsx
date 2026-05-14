import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Sparkles, Wand2, Copy, Check, Settings } from 'lucide-react';
import { aiApi, projectsApi } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useAiConfigured } from '@/hooks/useAiConfigured';

const EXAMPLES = [
  'Create a login smoke test for the admin portal at /admin/login',
  'Test the user registration flow including email validation',
  'Verify the dashboard loads and shows the correct navigation links',
  'Check the logout button signs out and redirects to /login',
  'Test that GET /api/users returns 200 with a JSON array',
];

export function AiPage() {
  const [projectId, setProjectId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const { data: projects = [] } = useQuery({ queryKey: ['projects'], queryFn: projectsApi.list });
  const { configured: aiConfigured, isLoading: aiCheckLoading } = useAiConfigured();

  async function generate() {
    if (!prompt.trim() || !projectId) return;
    setLoading(true); setError(''); setResult('');
    try { const d = await aiApi.generateTest(projectId, prompt); setResult(JSON.stringify(d, null, 2)); }
    catch (err: unknown) { setError(err instanceof Error ? err.message : 'Generation failed'); }
    finally { setLoading(false); }
  }

  function copy() { navigator.clipboard.writeText(result); setCopied(true); setTimeout(() => setCopied(false), 2000); }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div><h2 className="text-xl font-bold text-gray-900">AI Test Generator</h2><p className="text-sm text-gray-500 mt-0.5">Describe what you want to test — AI generates a step-by-step test definition.</p></div>
      {!aiCheckLoading && !aiConfigured && (
        <div className="rounded-xl border p-4 text-sm flex items-start gap-3" style={{ background: 'rgba(245,158,11,0.06)', borderColor: 'rgba(245,158,11,0.30)' }}>
          <Settings className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
          <div className="flex-1">
            <div className="font-medium text-gray-900">AI isn&rsquo;t configured for this organisation yet</div>
            <div className="text-gray-600 mt-0.5">Generation needs an API key (Gemini, OpenAI, Anthropic, or self-hosted). Set one up to enable this page.</div>
          </div>
          <Link to="/org/ai-settings"><Button size="sm" variant="secondary">Configure AI →</Button></Link>
        </div>
      )}
      <Card>
        <CardContent className="space-y-4">
          <div><label className="block text-xs font-medium text-gray-700 mb-1">Project</label>
            <select className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" value={projectId} onChange={e => setProjectId(e.target.value)}>
              <option value="">Select a project...</option>
              {(projects as Record<string,string>[]).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></div>
          <div><label className="block text-xs font-medium text-gray-700 mb-1">What should the test do?</label>
            <textarea className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 resize-none" rows={4} placeholder="e.g. Create a smoke test for the login flow..." value={prompt} onChange={e => setPrompt(e.target.value)} /></div>
          <Button onClick={generate} loading={loading} disabled={!prompt.trim() || !projectId || !aiConfigured || aiCheckLoading} className="w-full justify-center"><Wand2 size={14} /> Generate Test Definition</Button>
        </CardContent>
      </Card>
      <div>
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Example prompts</h3>
        <div className="space-y-2">{EXAMPLES.map(ex => <button key={ex} onClick={() => setPrompt(ex)} className="w-full text-left text-sm text-gray-600 hover:text-sky-700 hover:bg-sky-50 px-3 py-2 rounded-lg border border-transparent hover:border-sky-200 transition-all"><span className="text-sky-400 mr-2">→</span>{ex}</button>)}</div>
      </div>
      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl">{error}</div>}
      {result && (
        <Card>
          <CardHeader><div className="flex items-center justify-between"><div className="flex items-center gap-2"><Sparkles size={14} className="text-violet-500" /><CardTitle>Generated Test Definition</CardTitle></div>
            <button onClick={copy} className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700">{copied ? <Check size={13} className="text-green-500" /> : <Copy size={13} />}{copied ? 'Copied!' : 'Copy JSON'}</button></div></CardHeader>
          <CardContent className="p-0"><pre className="p-5 text-xs font-mono text-gray-700 overflow-x-auto leading-relaxed">{result}</pre></CardContent>
          <div className="px-5 pb-4"><p className="text-xs text-gray-400">Copy this JSON and paste it into the Test Editor to save it.</p></div>
        </Card>
      )}
    </div>
  );
}
