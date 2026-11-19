import React, { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  Check,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Link2,
  Loader2,
  Package,
  Play,
  RefreshCw,
  Terminal,
  Upload,
} from 'lucide-react';
import {
  fetchAvailableSkills,
  fetchMcpAuthStatus,
  fetchMcpTools,
  invokeMcpTool,
  type ClaudeSkillMeta,
  type McpAuthBridgeStatus,
} from '../lib/api';
import type { ExamSession } from '../shared/types';

interface McpControlCenterProps {
  session: ExamSession;
  user: User | null;
  accessToken: string | null;
  onSignIn: () => Promise<void>;
  onRefreshToken: () => Promise<string | null>;
  onRefreshSession: () => Promise<void>;
}

interface McpToolMeta {
  name: string;
  title: string;
  description: string;
}

function defaultArgsForTool(toolName: string, sessionId: string): string {
  switch (toolName) {
    case 'upload_material':
      return JSON.stringify(
        {
          sessionId,
          typedTitle: 'Catatan Materi Uji MCP',
          typedText:
            'Fotosintesis adalah proses biokimia pada tumbuhan berklorofil yang mengubah karbon dioksida (CO2) dan air (H2O) dengan bantuan energi cahaya matahari menjadi glukosa (C6H12O6) dan oksigen (O2). Reaksi terang terjadi di tilakoid, sedangkan siklus Calvin terjadi di stroma.',
        },
        null,
        2
      );
    case 'analyze_material':
      return JSON.stringify(
        {
          sessionId,
          materialText:
            'Termodinamika mempelajari hubungan antara kalor, usaha, suhu, dan energi. Hukum I Termodinamika menyatakan energi tidak dapat diciptakan atau dimusnahkan (Delta U = Q - W).',
        },
        null,
        2
      );
    case 'generate_questions':
      return JSON.stringify(
        {
          sessionId,
          questionTypes: ['multiple_choice_5'],
          questionCount: 5,
          cognitiveFocus: 'Mixed',
          targetTotalPoints: 50,
          strictSourceOnly: true,
        },
        null,
        2
      );
    case 'create_google_form':
      return JSON.stringify(
        {
          sessionId,
          includeParticipantIdentity: true,
          approved: true,
        },
        null,
        2
      );
    case 'publish_exam':
      return JSON.stringify(
        {
          sessionId,
          approved: false,
        },
        null,
        2
      );
    default:
      return JSON.stringify({ sessionId }, null, 2);
  }
}

export const McpControlCenter: React.FC<McpControlCenterProps> = ({
  session,
  user,
  accessToken,
  onSignIn,
  onRefreshToken,
  onRefreshSession,
}) => {
  const [tools, setTools] = useState<McpToolMeta[]>([]);
  const [selectedTool, setSelectedTool] = useState<string>('analyze_material');
  const [argsJson, setArgsJson] = useState<string>(() =>
    defaultArgsForTool('analyze_material', session.id)
  );
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [bridgeStatus, setBridgeStatus] = useState<McpAuthBridgeStatus | null>(null);
  const [skills, setSkills] = useState<ClaudeSkillMeta[]>([]);
  const [suiteDownloadUrl, setSuiteDownloadUrl] = useState<string>(
    '/api/skills/download?skill=all-suite'
  );

  useEffect(() => {
    void fetchMcpTools()
      .then((res) => setTools(res.tools))
      .catch(() => {
        // Keep UI responsive
      });
    void fetchAvailableSkills()
      .then((res) => {
        setSkills(res.skills);
        if (res.suiteDownloadUrl) setSuiteDownloadUrl(res.suiteDownloadUrl);
      })
      .catch(() => {
        // Keep UI responsive
      });
  }, []);

  useEffect(() => {
    void fetchMcpAuthStatus(session.id)
      .then((status) => setBridgeStatus(status))
      .catch(() => {
        // Ignore status check error
      });
  }, [session.id, accessToken]);

  useEffect(() => {
    setArgsJson(defaultArgsForTool(selectedTool, session.id));
  }, [selectedTool, session.id]);

  const origin =
    typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';

  const streamableUrl = `${origin}/mcp`;
  const sseUrl = `${origin}/sse`;
  const connectUrl = `${origin}/connect?sessionId=${encodeURIComponent(session.id)}`;
  const uploadUrl = `${origin}/upload?sessionId=${encodeURIComponent(session.id)}`;

  const claudeDesktopConfig = JSON.stringify(
    {
      mcpServers: {
        'assesscraft-remote': {
          type: 'streamable-http',
          url: streamableUrl,
        },
      },
    },
    null,
    2
  );

  const stdioConfig = JSON.stringify(
    {
      mcpServers: {
        'assesscraft-universal': {
          command: 'node',
          args: ['/ABSOLUTE/PATH/TO/APP/src/mcp/stdio.ts'],
          env: {
            GEMINI_API_KEY: 'YOUR_GEMINI_API_KEY',
          },
        },
      },
    },
    null,
    2
  );

  const handleRunTool = async () => {
    setErrorMsg('');
    setOutput('');
    let parsedArgs: Record<string, unknown>;
    try {
      parsedArgs = JSON.parse(argsJson) as Record<string, unknown>;
    } catch {
      setErrorMsg('JSON argumen tidak valid. Periksa sintaks JSON Anda.');
      return;
    }

    setRunning(true);
    try {
      const result = await invokeMcpTool(selectedTool, parsedArgs, accessToken);
      setOutput(JSON.stringify(result, null, 2));
      await onRefreshSession();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal menjalankan tool.');
    } finally {
      setRunning(false);
    }
  };

  const copyText = async (id: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1600);
  };

  const isBridgeConnected = Boolean(bridgeStatus?.connected || accessToken);

  return (
    <div className="space-y-6">
      {/* Remote MCP Gateway Overview */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="space-y-1">
            <p className="text-xs font-mono uppercase tracking-wider text-blue-700">
              Claude Autonomous Agent · Remote MCP Gateway
            </p>
            <h1 className="font-display text-xl font-bold text-slate-900">
              Endpoint HTTPS Remote MCP Server
            </h1>
            <p className="text-sm text-slate-600 leading-relaxed">
              Daftarkan salah satu endpoint di bawah sebagai Custom Connector di{' '}
              <span className="font-semibold text-slate-900">claude.ai</span> (Web, Desktop, atau Mobile),
              lalu kirim foto atau dokumen materi langsung di chat Claude.
            </p>
          </div>

          <div className="space-y-3">
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-700">
                  Streamable HTTP MCP URL (Utama untuk Claude)
                </p>
                <p className="text-xs font-mono text-slate-900 truncate mt-0.5">{streamableUrl}</p>
              </div>
              <button
                type="button"
                onClick={() => void copyText('mcp-url', streamableUrl)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 shrink-0"
              >
                {copiedId === 'mcp-url' ? <Check className="w-3.5 h-3.5 text-emerald-700" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedId === 'mcp-url' ? 'Tersalin' : 'Salin URL'}
              </button>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-700">
                  HTTP + SSE MCP URL (Kompatibilitas Legacy)
                </p>
                <p className="text-xs font-mono text-slate-900 truncate mt-0.5">{sseUrl}</p>
              </div>
              <button
                type="button"
                onClick={() => void copyText('sse-url', sseUrl)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 shrink-0"
              >
                {copiedId === 'sse-url' ? <Check className="w-3.5 h-3.5 text-emerald-700" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedId === 'sse-url' ? 'Tersalin' : 'Salin URL'}
              </button>
            </div>
          </div>

          <div className="pt-1 flex flex-wrap items-center gap-4 text-xs text-slate-600">
            <a
              href={uploadUrl}
              className="inline-flex items-center gap-1.5 font-semibold text-blue-700 hover:underline"
            >
              <Upload className="w-3.5 h-3.5" /> Portal Upload HP (/upload)
            </a>
            <span className="text-slate-300">·</span>
            <a
              href={connectUrl}
              className="inline-flex items-center gap-1.5 font-semibold text-blue-700 hover:underline"
            >
              <Link2 className="w-3.5 h-3.5" /> Halaman OAuth HP (/connect)
            </a>
          </div>
        </div>

        {/* OAuth 2.0 Bridge Card */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between space-y-4">
          <div className="space-y-2">
            <h2 className="text-base font-semibold text-slate-900">
              Status Google OAuth 2.0 untuk Remote MCP
            </h2>
            <p className="text-xs text-slate-600 leading-relaxed">
              Ketika Anda menghubungkan akun Google di sini atau via <span className="font-mono">/connect</span> di HP,
              Claude Remote MCP otomatis memiliki izin membuat Google Form tanpa menempelkan token manual.
            </p>
          </div>

          {isBridgeConnected ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-emerald-950">
                <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                Terotorisasi ke Google Forms API
              </div>
              <p className="text-xs text-emerald-900">
                Akun: <span className="font-medium">{bridgeStatus?.email || user?.email || 'Pengguna Google'}</span>
                {bridgeStatus?.expiresInSeconds
                  ? ` · Sisa ${Math.max(1, Math.round(bridgeStatus.expiresInSeconds / 60))} menit`
                  : ''}
              </p>
              <div className="pt-1 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void onRefreshToken()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-950 bg-white border border-emerald-300 rounded-lg hover:bg-emerald-100"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Perbarui Sesi OAuth
                </button>
                <a
                  href={connectUrl}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
                >
                  Buka /connect <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          ) : (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-3">
              <p className="text-xs text-amber-950 leading-relaxed">
                Akun Google Forms belum terhubung ke server MCP. Hubungkan sekarang (atau melalui tautan <span className="font-mono">/connect</span> yang dikirim Claude).
              </p>
              <button
                type="button"
                onClick={() => void onSignIn()}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-700 rounded-lg hover:bg-blue-800"
              >
                Hubungkan Akun Google (OAuth 2.0)
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Claude AI Skill (.zip) & Plugin Suite */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1 max-w-2xl">
            <p className="text-xs font-mono uppercase tracking-wider text-blue-700">
              Agent Skills · Format SKILL.md &amp; Plugin Claude
            </p>
            <h2 className="text-lg font-semibold text-slate-900">
              Instal Skill ke Claude AI (Upload .zip) &amp; Claude Code
            </h2>
            <p className="text-xs text-slate-600 leading-relaxed">
              Paket skill modular bergaya <span className="font-mono">SKILL.md</span> lengkap dengan{' '}
              <span className="font-mono">references/</span> dan manifest{' '}
              <span className="font-mono">.claude-plugin/</span>. Unggah file{' '}
              <span className="font-mono">assesscraft-form-builder.zip</span> di{' '}
              <span className="font-semibold text-slate-800">Claude.ai &rarr; Customize / Settings &rarr; Skills &rarr; Upload skill</span>.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <a
              href="/api/skills/download?skill=assesscraft-form-builder"
              download="assesscraft-form-builder.zip"
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-700 rounded-lg hover:bg-blue-800 whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              Unduh Skill Claude.ai (.zip)
            </a>
            <a
              href={suiteDownloadUrl}
              download="assesscraft-skill-suite.zip"
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap"
            >
              <Package className="w-3.5 h-3.5" />
              Unduh Suite Lengkap (5 Skill)
            </a>
          </div>
        </div>

        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-2">
          <p className="text-xs font-semibold text-slate-800">
            Instal Langsung via Link GitHub (Zero-Config, Tanpa <span className="font-mono">npm install</span>)
          </p>
          <p className="text-xs text-slate-600 leading-relaxed">
            Push repositori ini ke GitHub (sudah berisi <span className="font-mono">.mcp.json</span>,{' '}
            <span className="font-mono">.claude-plugin/</span>, dan bundle skrip{' '}
            <span className="font-mono">scripts/*.mjs</span>), lalu instal cukup dengan link GitHub Anda:
          </p>
          <pre className="text-xs font-mono bg-white border border-slate-200 rounded-md p-3 overflow-x-auto text-slate-800">
{`# Claude Code (Plugin + MCP + Google OAuth Bridge otomatis)
/plugin marketplace add https://github.com/<USERNAME>/<REPO_ANDA>
/plugin install assesscraft-skill@assesscraft-skill

# Atau via Agent Skills CLI (Claude Code / Cursor / Codex)
npx skills add https://github.com/<USERNAME>/<REPO_ANDA>`}
          </pre>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {skills.map((sk) => (
            <div
              key={sk.id}
              className="border border-slate-200 rounded-lg p-3.5 bg-slate-50/70 flex flex-col justify-between gap-3"
            >
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-mono font-semibold text-slate-900 truncate">
                    {sk.name}
                  </span>
                  {sk.primary && (
                    <span className="text-[11px] font-medium text-blue-700 shrink-0">
                      Skill Utama
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-600 leading-relaxed line-clamp-3">
                  {sk.description}
                </p>
              </div>
              <a
                href={sk.downloadUrl}
                download={`${sk.id}.zip`}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700 hover:underline"
              >
                <Download className="w-3.5 h-3.5" />
                Unduh {sk.id}.zip
              </a>
            </div>
          ))}
        </div>
      </section>

      {/* Tool Directory + Inspector */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: 12 MCP Tools Directory */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Claude Custom MCP Tools ({tools.length || 12})
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              Pilih tool untuk menguji eksekusi langsung terhadap sesi aktif{' '}
              <span className="font-mono text-slate-900">{session.id}</span>.
            </p>
          </div>

          <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg overflow-hidden">
            {tools.map((tool) => {
              const active = selectedTool === tool.name;
              return (
                <button
                  key={tool.name}
                  type="button"
                  onClick={() => setSelectedTool(tool.name)}
                  className={`w-full text-left p-3 transition-colors ${
                    active ? 'bg-blue-50' : 'bg-white hover:bg-slate-50'
                  }`}
                >
                  <p className="text-xs font-mono font-semibold text-slate-900">
                    {tool.name}
                  </p>
                  <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                    {tool.description}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right: Interactive MCP Runner & Config */}
        <div className="lg:col-span-7 space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-blue-700" />
                <h3 className="text-base font-semibold text-slate-900">
                  Uji Tool MCP: <span className="font-mono">{selectedTool}</span>
                </h3>
              </div>
              <button
                type="button"
                onClick={() => void handleRunTool()}
                disabled={running}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-700 rounded-lg hover:bg-blue-800 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                {running ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Play className="w-3.5 h-3.5" />
                )}
                Jalankan MCP Tool
              </button>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                Argumen JSON
              </label>
              <textarea
                rows={7}
                value={argsJson}
                onChange={(e) => setArgsJson(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            {errorMsg && (
              <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
                {errorMsg}
              </p>
            )}

            {output && (
              <div>
                <p className="text-xs font-semibold text-slate-600 mb-1">
                  Respons MCP Server
                </p>
                <pre className="max-h-72 overflow-auto text-xs font-mono bg-slate-900 text-slate-100 rounded-lg p-4 whitespace-pre-wrap">
                  {output}
                </pre>
              </div>
            )}
          </div>

          {/* Claude Remote & Stdio Config */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                Konfigurasi Koneksi Claude AI &amp; Claude Desktop
              </h3>
              <p className="text-xs text-slate-600 mt-0.5">
                Salin konfigurasi JSON berikut untuk menghubungkan Claude melalui Streamable HTTP atau Stdio lokal.
              </p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-slate-700">
                  1. Remote Streamable HTTP MCP (/mcp)
                </span>
                <button
                  type="button"
                  onClick={() => void copyText('http', claudeDesktopConfig)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline"
                >
                  {copiedId === 'http' ? (
                    <>
                      <Check className="w-3.5 h-3.5" /> Tersalin
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" /> Salin JSON
                    </>
                  )}
                </button>
              </div>
              <pre className="text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg p-3 overflow-x-auto text-slate-800">
                {claudeDesktopConfig}
              </pre>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-slate-700">
                  2. Claude Desktop Stdio (claude_desktop_config.json)
                </span>
                <button
                  type="button"
                  onClick={() => void copyText('stdio', stdioConfig)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline"
                >
                  {copiedId === 'stdio' ? (
                    <>
                      <Check className="w-3.5 h-3.5" /> Tersalin
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" /> Salin JSON
                    </>
                  )}
                </button>
              </div>
              <pre className="text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg p-3 overflow-x-auto text-slate-800">
                {stdioConfig}
              </pre>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
