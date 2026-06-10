import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { campaignsApi, profilesApi, parseApi, generateApi, sendApi } from '../api/client';
import { AppLayout } from '../components/layout/AppLayout';
import { Campaign, Candidate, GeneratedEmail, SenderProfile, ContactHistoryEntry, CooldownWarning } from '../types';
import { useT } from '../lib/i18n';

type Tab = 'candidates' | 'generate' | 'review' | 'send';

const STATUS_BADGE: Record<string, string> = {
  PENDING: 'badge-pending',
  GENERATING: 'badge-generating',
  GENERATED: 'badge-generated',
  SENT: 'badge-sent',
  ERROR: 'badge-error',
};

const STYLES = ['PROFESSIONAL', 'WARM', 'CONCISE', 'STORYTELLING'] as const;

function CandidateSourceSelector({ onAdd }: { onAdd: (candidates: any[]) => void }) {
  const { t } = useT();
  const d = t.detail;
  const [mode, setMode] = useState<'csv' | 'paste' | 'file' | 'url'>('csv');
  const [pasteText, setPasteText] = useState('');
  const [urlText, setUrlText] = useState('');
  const [urlResults, setUrlResults] = useState<{ ok: number; fail: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [parseProgress, setParseProgress] = useState('');
  const [error, setError] = useState('');

  async function handleCsv(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setError('');
    try {
      const res = await parseApi.csv(file);
      onAdd(res.data.candidates);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Parse failed');
    } finally { setLoading(false); e.target.value = ''; }
  }

  function handlePaste() {
    if (!pasteText.trim()) return;
    const blocks = pasteText.split(/\n---+\n/).map(b => b.trim()).filter(Boolean);
    const candidates = blocks.map((block) => {
      const emailMatch = block.match(/\b[\w.+-]+@[\w-]+\.[a-z]{2,}\b/i);
      const nameMatch = block.split('\n')[0];
      return {
        name: nameMatch.length < 60 ? nameMatch : undefined,
        email: emailMatch ? emailMatch[0] : undefined,
        rawText: block,
        source: 'paste',
      };
    });
    onAdd(candidates);
    setPasteText('');
  }

  async function handleUrls() {
    const urls = urlText.split('\n').map(u => u.trim()).filter(u => u.startsWith('http'));
    if (!urls.length) return;
    setLoading(true);
    setError('');
    setUrlResults(null);
    try {
      const res = await parseApi.urls(urls);
      const successful = res.data.candidates.filter((r: any) => r.ok).map((r: any) => r.candidate);
      const failCount = res.data.candidates.filter((r: any) => !r.ok).length;
      if (successful.length) onAdd(successful);
      setUrlResults({ ok: successful.length, fail: failCount });
      if (failCount === 0) setUrlText('');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Import failed');
    } finally { setLoading(false); }
  }

  const SUPPORTED_EXTS = ['.pdf', '.docx', '.jpg', '.jpeg', '.png', '.webp'];

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    // Filter unsupported files
    const invalid = files.filter(f => !SUPPORTED_EXTS.some(ext => f.name.toLowerCase().endsWith(ext)));
    if (invalid.length) {
      setError(`Unsupported file type: ${invalid.map(f => f.name).join(', ')}. Supported: PDF, DOCX, JPG, PNG, WEBP`);
      e.target.value = '';
      return;
    }

    setLoading(true);
    setError('');
    const collected: any[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setParseProgress(`Parsing ${i + 1} / ${files.length}: ${file.name}`);
      try {
        const res = await parseApi.file(file);
        const emailMatch = res.data.text.match(/\b[\w.+-]+@[\w-]+\.[a-z]{2,}\b/i);
        const lines = res.data.text.split('\n');
        collected.push({
          name: lines[0]?.substring(0, 60) || file.name,
          email: emailMatch ? emailMatch[0] : undefined,
          rawText: res.data.text,
          source: res.data.source,
        });
      } catch (err: any) {
        setError(`Failed on ${file.name}: ${err.response?.data?.error || 'Parse failed'}`);
      }
    }
    if (collected.length) onAdd(collected);
    setLoading(false);
    setParseProgress('');
    e.target.value = '';
  }

  return (
    <div className="card p-4 space-y-3">
      <div className="flex gap-1 flex-wrap">
        {(['csv', 'paste', 'file', 'url'] as const).map(m => (
          <button key={m} onClick={() => { setMode(m); setUrlResults(null); setError(''); }} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${mode === m ? 'bg-sky-100 text-sky-700' : 'text-gray-500 hover:bg-gray-50'}`}>
            {m === 'csv' ? d.csvExcel : m === 'paste' ? d.pasteText : m === 'file' ? d.resumeFiles : d.websiteUrls}
          </button>
        ))}
      </div>

      {mode === 'csv' && (
        <div className="space-y-2">
          <p className="text-xs text-gray-500">Upload a CSV or Excel file. Columns should include: name, email, background/bio/summary.</p>
          <label className="flex items-center gap-2 cursor-pointer">
            <span className="btn-secondary">{loading ? 'Parsing...' : 'Choose File'}</span>
            <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleCsv} disabled={loading} />
          </label>
        </div>
      )}

      {mode === 'paste' && (
        <div className="space-y-2">
          <p className="text-xs text-gray-500">Paste candidate backgrounds separated by <code className="bg-gray-100 px-1 rounded">---</code>. Each block = one candidate.</p>
          <textarea
            className="input h-36 resize-none font-mono text-xs"
            placeholder={"John Smith\nSenior Engineer at Google...\n\n---\n\nJane Doe\nProduct Manager at Meta..."}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
          />
          <button className="btn-primary" onClick={handlePaste} disabled={!pasteText.trim()}>Add Candidates</button>
        </div>
      )}

      {mode === 'file' && (
        <div className="space-y-2">
          <p className="text-xs text-gray-500">Upload one or more resumes (PDF, Word, or image). Each file = one candidate.</p>
          <label className="relative inline-flex cursor-pointer">
            <span className="btn-secondary">{loading ? parseProgress || 'Parsing...' : 'Choose Files'}</span>
            <input
              type="file"
              accept=".pdf,.docx,.jpg,.jpeg,.png,.webp"
              className="absolute inset-0 opacity-0 cursor-pointer"
              onChange={handleFiles}
              disabled={loading}
            />
          </label>
          {loading && parseProgress && <p className="text-xs text-sky-600">{parseProgress}</p>}
        </div>
      )}
      {mode === 'url' && (
        <div className="space-y-2">
          <p className="text-xs text-gray-500">{d.urlsHint}</p>
          <textarea
            className="input h-36 resize-none font-mono text-xs"
            placeholder={d.urlsPlaceholder}
            value={urlText}
            onChange={(e) => setUrlText(e.target.value)}
          />
          <div className="flex items-center gap-3">
            <button
              className="btn-primary"
              onClick={handleUrls}
              disabled={loading || !urlText.trim()}
            >
              {loading ? d.urlsImporting : d.urlsImport}
            </button>
            {urlResults && (
              <span className={`text-sm font-medium ${urlResults.fail > 0 ? 'text-amber-600' : 'text-green-600'}`}>
                {d.urlsResult(urlResults.ok, urlResults.fail)}
              </span>
            )}
          </div>
        </div>
      )}

      {error && <p className="text-red-600 text-sm">{error}</p>}
    </div>
  );
}

function EmailReviewCard({ email, candidateName, onApprove, onEdit, onRestyle }: {
  email: GeneratedEmail;
  candidateName?: string;
  onApprove: (approved: boolean) => void;
  onEdit: (subject: string, body: string) => void;
  onRestyle: (style: string) => void;
}) {
  const { t } = useT();
  const d = t.detail;
  const [editing, setEditing] = useState(false);
  const [editSubject, setEditSubject] = useState(email.subject);
  const [editBody, setEditBody] = useState(email.body);
  const [showRestyle, setShowRestyle] = useState(false);

  function saveEdit() {
    onEdit(editSubject, editBody);
    setEditing(false);
  }

  return (
    <div className={`p-4 space-y-3 ${email.approved ? 'bg-green-50' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          {candidateName && <p className="text-xs text-gray-500 mb-1">{candidateName}</p>}
          {editing ? (
            <input className="input text-sm font-medium" value={editSubject} onChange={(e) => setEditSubject(e.target.value)} />
          ) : (
            <p className="text-sm font-semibold truncate">{email.subject}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {email.approved && <span className="text-xs text-green-600 font-medium">Approved</span>}
          <button
            onClick={() => onApprove(!email.approved)}
            className={`text-xs px-2 py-1 rounded border transition-colors ${email.approved ? 'border-green-400 bg-green-100 text-green-700' : 'border-gray-200 bg-white text-gray-600 hover:border-sky-300'}`}
          >
            {email.approved ? d.unapprove : d.approve}
          </button>
          {!editing ? (
            <button className="text-xs px-2 py-1 rounded border border-gray-200 bg-white text-gray-600 hover:bg-gray-50" onClick={() => setEditing(true)}>{d.edit}</button>
          ) : (
            <button className="text-xs px-2 py-1 rounded border border-sky-300 bg-sky-50 text-sky-700" onClick={saveEdit}>{d.saveEdit}</button>
          )}
          {!editing && (
            <div className="relative">
              <button
                className="text-xs px-2 py-1 rounded border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                onClick={() => setShowRestyle(!showRestyle)}
              >
                {email.style && email.style !== 'AUTO'
                  ? email.style.charAt(0) + email.style.slice(1).toLowerCase()
                  : d.style} ▾
              </button>
              {showRestyle && (
                <div className="absolute right-0 top-8 z-10 bg-white border border-gray-200 rounded-lg shadow-lg p-1.5 min-w-40">
                  {STYLES.map(s => {
                    const isCurrent = email.style === s;
                    return (
                      <button
                        key={s}
                        className={`flex items-center justify-between w-full text-left px-3 py-1.5 text-xs rounded transition-colors ${
                          isCurrent
                            ? 'bg-sky-50 text-sky-700 font-medium cursor-default'
                            : 'text-gray-700 hover:bg-gray-50'
                        }`}
                        onClick={() => { if (!isCurrent) { onRestyle(s); setShowRestyle(false); } }}
                      >
                        <span>{s.charAt(0) + s.slice(1).toLowerCase()}</span>
                        {isCurrent && <span className="text-sky-500 ml-2">✓ auto-matched</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {editing ? (
        <textarea className="input text-sm resize-none h-40 font-mono" value={editBody} onChange={(e) => setEditBody(e.target.value)} />
      ) : (
        <pre className="text-xs text-gray-700 whitespace-pre-wrap leading-relaxed">{email.body}</pre>
      )}
    </div>
  );
}

export function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { t } = useT();
  const d = t.detail;
  const [tab, setTab] = useState<Tab>('candidates');
  const [sendResults, setSendResults] = useState<any[]>([]);
  const [showEdit, setShowEdit] = useState(false);
  const [editForm, setEditForm] = useState<{ name: string; jobTitle: string; profileId: string; language: string; emailCount: number } | null>(null);
  // Feature 2: note editing state
  const [expandedNoteId, setExpandedNoteId] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  // Inline name editing
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [editingNameValue, setEditingNameValue] = useState('');
  // Inline email editing
  const [editingEmailId, setEditingEmailId] = useState<string | null>(null);
  const [editingEmailValue, setEditingEmailValue] = useState('');
  // Generate tab: selected candidates
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<Set<string>>(new Set());
  // Regen request modal for SENT candidates
  const [regenModal, setRegenModal] = useState<{ candidateId: string; name: string } | null>(null);
  const [regenReason, setRegenReason] = useState('');
  // Ticker to update countdowns every 30s
  const [, setTick] = useState(0);
  useEffect(() => {
    if (tab !== 'generate') return;
    const timer = setInterval(() => setTick(t => t + 1), 30000);
    return () => clearInterval(timer);
  }, [tab]);
  // Feature 1: cooldown warnings from 409
  const [cooldownWarnings, setCooldownWarnings] = useState<CooldownWarning[]>([]);

  const { data: campaign, isLoading, error } = useQuery<Campaign>({
    queryKey: ['campaigns', id],
    queryFn: () => campaignsApi.get(id!).then(r => r.data),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'GENERATING' ? 2000 : false;
    },
  });

  const { data: profiles = [] } = useQuery<SenderProfile[]>({
    queryKey: ['profiles'],
    queryFn: () => profilesApi.list().then(r => r.data),
  });

  // Feature 1: contact history
  const { data: contactHistory = {} } = useQuery<Record<string, ContactHistoryEntry>>({
    queryKey: ['contact-history', id],
    queryFn: () => campaignsApi.getContactHistory(id!).then(r => r.data),
    enabled: !!id,
  });

  function openEdit() {
    if (!campaign) return;
    setEditForm({
      name: campaign.name,
      jobTitle: campaign.jobTitle || '',
      profileId: campaign.profile?.id || '',
      language: campaign.language,
      emailCount: campaign.emailCount,
    });
    setShowEdit(true);
  }

  const updateCampaign = useMutation({
    mutationFn: () => campaignsApi.update(id!, {
      ...editForm,
      profileId: editForm?.profileId || undefined,
      emailCount: Number(editForm?.emailCount),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['campaigns', id] }); setShowEdit(false); },
  });

  const addCandidates = useMutation({
    mutationFn: (candidates: any[]) => campaignsApi.addCandidates(id!, candidates),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['campaigns', id] }),
  });

  const deleteCandidate = useMutation({
    mutationFn: (cid: string) => campaignsApi.deleteCandidate(cid),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['campaigns', id] }),
  });

  // Auto-select un-generated candidates when entering generate tab
  useEffect(() => {
    if (tab === 'generate' && campaign) {
      const ungenerated = campaign.candidates.filter(c => c.emails.length === 0).map(c => c.id);
      setSelectedCandidateIds(new Set(ungenerated));
    }
  }, [tab, campaign?.candidates.length]);

  const generate = useMutation({
    mutationFn: () => generateApi.campaign(id!, Array.from(selectedCandidateIds)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['campaigns', id] }); setTab('review'); },
  });

  const approveEmail = useMutation({
    mutationFn: ({ emailId, approved }: { emailId: string; approved: boolean }) =>
      approved ? generateApi.approveEmail(emailId) : generateApi.unapproveEmail(emailId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['campaigns', id] }),
  });

  const editEmail = useMutation({
    mutationFn: ({ emailId, subject, body }: { emailId: string; subject: string; body: string }) =>
      generateApi.updateEmail(emailId, subject, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['campaigns', id] }),
  });

  function handleApprove(candidateId: string, emailId: string, approved: boolean) {
    if (approved) {
      // Unapprove all other variants of the same candidate first
      const candidate = campaign?.candidates.find(c => c.id === candidateId);
      candidate?.emails
        .filter(e => e.approved && e.id !== emailId)
        .forEach(e => approveEmail.mutate({ emailId: e.id, approved: false }));
    }
    approveEmail.mutate({ emailId, approved });
  }

  const restyleEmail = useMutation({
    mutationFn: ({ emailId, style }: { emailId: string; style: string }) =>
      generateApi.restyle(emailId, style),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['campaigns', id] }),
  });

  const send = useMutation({
    mutationFn: (force = false) => sendApi.campaign(id!, force),
    onSuccess: (res) => {
      setSendResults(res.data.results);
      setCooldownWarnings([]);
      qc.invalidateQueries({ queryKey: ['campaigns', id] });
      qc.invalidateQueries({ queryKey: ['contact-history', id] });
    },
    onError: (err: any) => {
      if (err.response?.status === 409 && err.response.data?.cooldownWarnings) {
        setCooldownWarnings(err.response.data.cooldownWarnings);
      }
    },
  });

  // Feature 2: save recruiter note
  const saveNote = useMutation({
    mutationFn: ({ candidateId, recruiterNote }: { candidateId: string; recruiterNote: string }) =>
      campaignsApi.updateCandidate(candidateId, { recruiterNote }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaigns', id] });
      setExpandedNoteId(null);
    },
  });

  const saveName = useMutation({
    mutationFn: ({ candidateId, name }: { candidateId: string; name: string }) =>
      campaignsApi.updateCandidate(candidateId, { name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaigns', id] });
      setEditingNameId(null);
    },
  });

  const saveEmail = useMutation({
    mutationFn: ({ candidateId, email }: { candidateId: string; email: string }) =>
      campaignsApi.updateCandidate(candidateId, { email }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaigns', id] });
      setEditingEmailId(null);
    },
  });

  const requestRegen = useMutation({
    mutationFn: ({ candidateId, reason }: { candidateId: string; reason: string }) =>
      campaignsApi.requestRegen(candidateId, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaigns', id] });
      setRegenModal(null);
      setRegenReason('');
    },
  });

  // Feature 2: regenerate single candidate
  const regenerateCandidate = useMutation({
    mutationFn: (candidateId: string) => generateApi.regenerateCandidate(candidateId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['campaigns', id] }),
  });

  // Feature 3: toggle reply
  const toggleReply = useMutation({
    mutationFn: (candidateId: string) => campaignsApi.toggleReply(candidateId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaigns', id] });
      qc.invalidateQueries({ queryKey: ['campaigns'] });
    },
  });

  const markSent = useMutation({
    mutationFn: (candidateId: string) => campaignsApi.markSent(candidateId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaigns', id] });
      qc.invalidateQueries({ queryKey: ['campaigns'] });
    },
  });

  const unmarkSent = useMutation({
    mutationFn: (candidateId: string) => campaignsApi.unmarkSent(candidateId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaigns', id] });
      qc.invalidateQueries({ queryKey: ['campaigns'] });
    },
  });

  if (isLoading) return <AppLayout><div className="text-center py-16 text-gray-500">{d.loading}</div></AppLayout>;
  if (error || !campaign) return <AppLayout><div className="text-center py-16 text-red-500">Project not found</div></AppLayout>;

  const sortedCandidates = [...campaign.candidates].sort((a, b) =>
    (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' })
  );
  const pendingCandidates = sortedCandidates.filter(c => c.status !== 'SENT');
  const approvedCount = pendingCandidates.flatMap(c => c.emails).filter(e => e.approved).length;
  const candidatesWithEmail = pendingCandidates.filter(c => c.email).length;

  return (
    <AppLayout>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <button onClick={() => navigate('/')} className="text-gray-400 hover:text-gray-600 text-sm">← Projects</button>
              <span className="text-gray-300">/</span>
              <h1 className="text-xl font-semibold">{campaign.name}</h1>
            </div>
            <div className="text-xs text-gray-500 mt-1 flex gap-3 flex-wrap">
              {campaign.jobTitle && <span>{campaign.jobTitle}</span>}
              {campaign.profile && <span>via {campaign.profile.name}</span>}
              <span>{campaign.language}</span>
              <span>{campaign.emailCount} variant{campaign.emailCount > 1 ? 's' : ''}/candidate</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn-secondary text-xs" onClick={openEdit}>Edit Settings</button>
            <span className={STATUS_BADGE[campaign.status] || 'badge-pending'}>{campaign.status}</span>
          </div>
        </div>

        {/* Edit Settings Panel */}
        {showEdit && editForm && (
          <div className="card p-5 space-y-4 border-sky-200">
            <h2 className="font-semibold text-sm">Edit Project Settings</h2>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="label">Project Name *</label>
                <input className="input" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
              </div>
              <div>
                <label className="label">Job Title</label>
                <input className="input" value={editForm.jobTitle} onChange={(e) => setEditForm({ ...editForm, jobTitle: e.target.value })} />
              </div>
              <div>
                <label className="label">Sender Profile</label>
                <select className="input" value={editForm.profileId} onChange={(e) => setEditForm({ ...editForm, profileId: e.target.value })}>
                  <option value="">No profile</option>
                  {profiles.map(p => <option key={p.id} value={p.id}>{p.name} @ {p.company}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Language</label>
                <select className="input" value={editForm.language} onChange={(e) => setEditForm({ ...editForm, language: e.target.value })}>
                  <option>English</option>
                  <option>Chinese (Simplified)</option>
                  <option>Japanese</option>
                  <option>Korean</option>
                  <option>German</option>
                  <option>French</option>
                </select>
              </div>
              <div>
                <label className="label">Emails per Candidate</label>
                <select className="input" value={editForm.emailCount} onChange={(e) => setEditForm({ ...editForm, emailCount: Number(e.target.value) })}>
                  <option value={1}>1 variant</option>
                  <option value={2}>2 variants</option>
                  <option value={3}>3 variants</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2">
              <button className="btn-primary" onClick={() => updateCampaign.mutate()} disabled={!editForm.name || updateCampaign.isPending}>
                {updateCampaign.isPending ? 'Saving...' : 'Save Changes'}
              </button>
              <button className="btn-secondary" onClick={() => setShowEdit(false)}>Cancel</button>
            </div>
            {updateCampaign.isError && (
              <p className="text-red-600 text-sm">{(updateCampaign.error as any)?.response?.data?.error || 'Error saving'}</p>
            )}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 border-b border-gray-200">
          {(['candidates', 'generate', 'review', 'send'] as Tab[]).map(tab_ => (
            <button key={tab_} onClick={() => setTab(tab_)} className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors capitalize ${tab === tab_ ? 'border-sky-500 text-sky-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
              {tab_ === 'candidates' ? `${d.candidates} (${campaign.candidates.length})` :
               tab_ === 'generate' ? d.generate :
               tab_ === 'review' ? `${d.review} (${approvedCount} approved)` :
               d.send}
            </button>
          ))}
        </div>

        {/* Tab: Candidates */}
        {tab === 'candidates' && (
          <div className="space-y-4">
            <CandidateSourceSelector onAdd={(candidates) => addCandidates.mutate(candidates)} />
            {addCandidates.isPending && <p className="text-sm text-sky-600">Adding candidates...</p>}
            {addCandidates.isError && <p className="text-sm text-red-600">{(addCandidates.error as any)?.response?.data?.error}</p>}

            {campaign.candidates.length > 0 ? (
              <div className="card overflow-hidden">
                <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[860px]">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-4 py-2.5 font-medium text-gray-600">Name</th>
                      <th className="text-left px-4 py-2.5 font-medium text-gray-600">Email</th>
                      <th className="text-left px-4 py-2.5 font-medium text-gray-600">Source</th>
                      <th className="text-left px-4 py-2.5 font-medium text-gray-600">Status</th>
                      <th className="text-left px-4 py-2.5 font-medium text-gray-600">Reply</th>
                      <th className="text-left px-4 py-2.5 font-medium text-gray-600">Text Preview</th>
                      <th className="px-4 py-2.5 whitespace-nowrap"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedCandidates.map((c) => {
                      const history = c.email ? contactHistory[c.email] : undefined;
                      const isNoteExpanded = expandedNoteId === c.id;
                      return (
                        <React.Fragment key={c.id}>
                          <tr className={`hover:bg-gray-50 border-b border-gray-100 ${c.sentCount >= 2 ? 'bg-orange-50/40' : ''}`}>
                            <td className="px-4 py-2.5 font-medium">
                              <div className="flex flex-col gap-0.5">
                                {editingNameId === c.id ? (
                                  <input
                                    autoFocus
                                    className="text-sm border border-sky-300 rounded px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-sky-400 w-36"
                                    value={editingNameValue}
                                    onChange={e => setEditingNameValue(e.target.value)}
                                    onBlur={() => saveName.mutate({ candidateId: c.id, name: editingNameValue })}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') saveName.mutate({ candidateId: c.id, name: editingNameValue });
                                      if (e.key === 'Escape') setEditingNameId(null);
                                    }}
                                  />
                                ) : (
                                  <span
                                    className={`cursor-pointer hover:underline ${c.sentCount >= 2 ? 'text-orange-700' : ''}`}
                                    title="Click to edit name"
                                    onClick={() => { setEditingNameId(c.id); setEditingNameValue(c.name || ''); }}
                                  >
                                    {c.name || '—'}
                                  </span>
                                )}
                                {c.sentCount > 0 && <span className="self-start text-xs text-orange-500 bg-orange-50 border border-orange-200 px-1.5 py-0.5 rounded-full">发 {c.sentCount}次</span>}
                              </div>
                            </td>
                            <td className="px-4 py-2.5 text-gray-600">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {editingEmailId === c.id ? (
                                  <input
                                    autoFocus
                                    className="text-sm border border-sky-300 rounded px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-sky-400 w-48"
                                    value={editingEmailValue}
                                    onChange={e => setEditingEmailValue(e.target.value)}
                                    onBlur={() => saveEmail.mutate({ candidateId: c.id, email: editingEmailValue })}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') saveEmail.mutate({ candidateId: c.id, email: editingEmailValue });
                                      if (e.key === 'Escape') setEditingEmailId(null);
                                    }}
                                  />
                                ) : (
                                  <span
                                    className={`cursor-pointer hover:underline ${c.email ? '' : 'text-orange-500 text-xs'}`}
                                    title="Click to edit email"
                                    onClick={() => { setEditingEmailId(c.id); setEditingEmailValue(c.email || ''); }}
                                  >
                                    {c.email || 'No email'}
                                  </span>
                                )}
                                {history && (
                                  <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded" title={`Sent via "${history.campaignName}"`}>
                                    ⚠️ {history.daysAgo}d ago
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-2.5"><span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{c.source}</span></td>
                            <td className="px-4 py-2.5">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className={STATUS_BADGE[c.status] || 'badge-pending'}>{c.status}</span>
                                {c.status === 'SENT' && c.sendLogs.every(l => l.subject === '[EXTERNAL]') && (
                                  <button className="text-xs text-gray-400 hover:text-red-500" title="取消外部标记" onClick={() => unmarkSent.mutate(c.id)}>✕</button>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-2.5">
                              {c.status === 'SENT' ? (
                                c.replied ? (
                                  <div className="flex items-center gap-1">
                                    <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                                      Replied {c.repliedAt ? new Date(c.repliedAt).toLocaleDateString() : ''}
                                    </span>
                                    <button className="text-xs text-gray-400 hover:text-gray-600" onClick={() => toggleReply.mutate(c.id)}>{d.markNotReplied}</button>
                                  </div>
                                ) : (
                                  <button className="text-xs text-gray-500 border border-gray-200 px-2 py-0.5 rounded hover:bg-gray-50" onClick={() => toggleReply.mutate(c.id)}>
                                    {d.markReplied}
                                  </button>
                                )
                              ) : <span className="text-gray-300 text-xs">—</span>}
                            </td>
                            <td className="px-4 py-2.5 text-gray-500 text-xs max-w-xs truncate">{c.rawText.substring(0, 80)}...</td>
                            <td className="px-4 py-2.5 whitespace-nowrap">
                              <div className="flex items-center gap-2">
                                <button
                                  className={`text-xs font-bold ${c.recruiterNote ? 'text-purple-600 hover:text-purple-800' : 'text-green-500 hover:text-green-600'}`}
                                  onClick={() => {
                                    if (isNoteExpanded) {
                                      setExpandedNoteId(null);
                                    } else {
                                      setExpandedNoteId(c.id);
                                      setNoteText(c.recruiterNote || '');
                                    }
                                  }}
                                >
                                  {c.recruiterNote ? '📝 Note' : 'Add note'}
                                </button>
                                {c.status !== 'SENT' && (
                                  <button className="text-xs text-sky-500 hover:text-sky-700" onClick={() => markSent.mutate(c.id)}>标记已发</button>
                                )}
                                <button className="text-xs text-red-400 hover:text-red-600" onClick={() => deleteCandidate.mutate(c.id)}>Remove</button>
                              </div>
                            </td>
                          </tr>
                          {isNoteExpanded && (
                            <tr className="bg-purple-50 border-b border-gray-100">
                              <td colSpan={7} className="px-4 py-3">
                                <div className="space-y-2">
                                  <p className="text-xs text-purple-700 font-medium">Personal observation (woven naturally into the email)</p>
                                  <textarea
                                    className="input text-sm h-20 resize-none w-full"
                                    placeholder="e.g. Met at React Conf 2024, mentioned interest in distributed systems..."
                                    value={noteText}
                                    onChange={(e) => setNoteText(e.target.value)}
                                    autoFocus
                                  />
                                  <div className="flex gap-2">
                                    <button
                                      className="btn-primary text-xs py-1"
                                      onClick={() => saveNote.mutate({ candidateId: c.id, recruiterNote: noteText })}
                                      disabled={saveNote.isPending}
                                    >
                                      {saveNote.isPending ? d.loading : d.saveNote}
                                    </button>
                                    <button className="btn-secondary text-xs py-1" onClick={() => setExpandedNoteId(null)}>{d.cancelEdit}</button>
                                    {c.recruiterNote && noteText === c.recruiterNote && (
                                      <button
                                        className="text-xs text-gray-400 hover:text-red-500 ml-auto"
                                        onClick={() => saveNote.mutate({ candidateId: c.id, recruiterNote: '' })}
                                      >
                                        Clear note
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
                </div>
              </div>
            ) : (
              <div className="text-center py-10 card text-gray-500">
                <p>No candidates yet. Add via CSV, paste, or resume files above.</p>
              </div>
            )}
          </div>
        )}

        {/* Tab: Generate */}
        {tab === 'generate' && (
          <div className="space-y-4">
            <div className="card p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">{d.generateEmails}</h2>
                <p className="text-xs text-gray-400">{selectedCandidateIds.size} / {campaign.candidates.length} selected · {selectedCandidateIds.size * campaign.emailCount} emails</p>
              </div>

              {!campaign.profile && (
                <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 text-sm p-3 rounded-lg">
                  No sender profile set. <button className="underline" onClick={openEdit}>Edit Settings</button> to add one.
                </div>
              )}

              {/* Candidate checklist */}
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-200">
                  <span className="text-xs font-medium text-gray-500">{d.candidates}</span>
                  <div className="flex gap-3">
                    <button className="text-xs text-sky-500 hover:text-sky-700" onClick={() => setSelectedCandidateIds(new Set(
                      sortedCandidates.filter(c => {
                        if (c.status !== 'SENT') return true;
                        const elapsed = c.regenRequestedAt ? Date.now() - new Date(c.regenRequestedAt).getTime() : null;
                        return elapsed !== null && elapsed >= 60 * 60 * 1000;
                      }).map(c => c.id)
                    ))}>{d.selectAll}</button>
                    <button className="text-xs text-gray-400 hover:text-gray-600" onClick={() => setSelectedCandidateIds(new Set())}>{d.deselectAll}</button>
                  </div>
                </div>
                <div className="divide-y divide-gray-100 max-h-72 overflow-y-auto">
                  {campaign.candidates.length === 0 ? (
                    <p className="text-sm text-gray-400 px-4 py-6 text-center">{d.noCandidates}</p>
                  ) : sortedCandidates.map(c => {
                    const checked = selectedCandidateIds.has(c.id);
                    const hasEmails = c.emails.length > 0;
                    const isSent = c.status === 'SENT';
                    const isGenerating = c.status === 'GENERATING';
                    const regenRequestedMs = c.regenRequestedAt ? new Date(c.regenRequestedAt).getTime() : null;
                    const elapsed = regenRequestedMs ? Date.now() - regenRequestedMs : null;
                    const COOLDOWN = 60 * 60 * 1000;
                    const regenEligible = isSent && elapsed !== null && elapsed >= COOLDOWN;
                    const regenPending = isSent && elapsed !== null && elapsed < COOLDOWN;
                    const regenNotRequested = isSent && !regenRequestedMs;
                    const minutesLeft = regenPending && elapsed !== null ? Math.ceil((COOLDOWN - elapsed) / 60000) : 0;

                    if (isSent && !regenEligible) {
                      // SENT + not yet eligible: show request button or countdown
                      return (
                        <div key={c.id} className="flex items-center gap-3 px-4 py-2.5 bg-gray-50 border-l-2 border-orange-300">
                          <input type="checkbox" disabled className="rounded border-gray-200 opacity-30" />
                          <div className="flex-1 min-w-0">
                            <span className="text-sm font-medium text-gray-500">{c.name || '—'}</span>
                            {c.email && <span className="text-xs text-gray-400 ml-2">{c.email}</span>}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {c.sentCount > 0 && <span className="text-xs text-orange-600 bg-orange-50 border border-orange-200 px-1.5 py-0.5 rounded-full">已发 {c.sentCount}次</span>}
                            {regenNotRequested && (
                              <button
                                className="text-xs text-red-500 border border-red-200 bg-red-50 px-2 py-0.5 rounded hover:bg-red-100"
                                onClick={() => { setRegenModal({ candidateId: c.id, name: c.name || '该人选' }); setRegenReason(''); }}
                              >申请重新生成</button>
                            )}
                            {regenPending && <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">冷却中 {minutesLeft}分钟后可选</span>}
                          </div>
                        </div>
                      );
                    }

                    return (
                      <label key={c.id} className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-gray-50 ${isGenerating ? 'opacity-50 pointer-events-none' : ''} ${regenEligible ? 'bg-orange-50' : ''}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={e => {
                            const next = new Set(selectedCandidateIds);
                            e.target.checked ? next.add(c.id) : next.delete(c.id);
                            setSelectedCandidateIds(next);
                          }}
                          className="rounded border-gray-300 text-sky-600"
                        />
                        <div className="flex-1 min-w-0">
                          <span className={`text-sm font-medium ${regenEligible ? 'text-orange-700' : 'text-gray-800'}`}>{c.name || '—'}</span>
                          {c.email && <span className="text-xs text-gray-400 ml-2">{c.email}</span>}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {c.sentCount > 0 && <span className="text-xs text-orange-600 bg-orange-50 border border-orange-200 px-1.5 py-0.5 rounded-full">已发 {c.sentCount}次</span>}
                          {isGenerating && <span className={STATUS_BADGE.GENERATING}>{c.status}</span>}
                          {regenEligible && <span className="text-xs text-orange-500 bg-orange-50 px-1.5 py-0.5 rounded">⚠️ 可重新生成</span>}
                          {hasEmails && !isSent && !isGenerating && <span className="text-xs text-green-600 bg-green-50 px-1.5 py-0.5 rounded">已生成</span>}
                          {!hasEmails && !isGenerating && !isSent && <span className="text-xs text-orange-500 bg-orange-50 px-1.5 py-0.5 rounded">待生成</span>}
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              {campaign.status === 'GENERATING' && (
                <div className="flex items-center gap-2 text-sky-600">
                  <div className="w-4 h-4 border-2 border-sky-600 border-t-transparent rounded-full animate-spin"></div>
                  <span className="text-sm">{d.generating}</span>
                </div>
              )}

              <button
                className="btn-primary"
                onClick={() => generate.mutate()}
                disabled={selectedCandidateIds.size === 0 || !campaign.profile || generate.isPending || campaign.status === 'GENERATING'}
              >
                {generate.isPending || campaign.status === 'GENERATING' ? d.generating : d.generateSelected(selectedCandidateIds.size)}
              </button>
              {generate.isError && <p className="text-red-600 text-sm">{(generate.error as any)?.response?.data?.error}</p>}
            </div>
          </div>
        )}

        {/* Tab: Review */}
        {tab === 'review' && (
          <div className="space-y-4">
            {(() => {
              const reviewCandidates = sortedCandidates.filter(c => c.status !== 'SENT' && c.emails.length > 0);
              const reviewApproved = reviewCandidates.filter(c => c.emails.some(e => e.approved)).length;
              return (<>
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-600">{reviewApproved} of {reviewCandidates.length} candidates have an approved email.</p>
              <div className="flex items-center gap-3">
                <p className="text-xs text-gray-400">Approve All selects Variant 1 for each candidate</p>
                <button
                  className="btn-secondary text-xs"
                  onClick={() => {
                    reviewCandidates.forEach(c => {
                      c.emails.forEach((e, idx) => {
                        if (idx === 0 && !e.approved) approveEmail.mutate({ emailId: e.id, approved: true });
                        if (idx > 0 && e.approved) approveEmail.mutate({ emailId: e.id, approved: false });
                      });
                    });
                  }}
                >
                  Approve All
                </button>
              </div>
            </div>

            {reviewCandidates.length === 0 && (
              <div className="card p-8 text-center text-gray-400 text-sm">
                {d.noEmails}
              </div>
            )}

            {reviewCandidates.map(c => (
              <div key={c.id} className={`card overflow-hidden ${c.sentCount >= 1 ? 'border-orange-300' : ''}`}>
                {/* Candidate header */}
                <div className={`px-4 py-3 border-b border-gray-200 flex items-center justify-between ${c.sentCount >= 1 ? 'bg-orange-50' : 'bg-gray-50'}`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`font-medium text-sm ${c.sentCount >= 1 ? 'text-orange-700' : ''}`}>{c.name || '—'}</span>
                    {c.sentCount >= 1 && <span className="text-xs text-orange-600 bg-white border border-orange-200 px-1.5 py-0.5 rounded-full">⚠️ 第{c.sentCount + 1}次发送</span>}
                    {c.email && <span className="text-xs text-gray-400">{c.email}</span>}
                    {c.recruiterNote && (
                      <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full" title={c.recruiterNote}>
                        📝 {c.recruiterNote.length > 40 ? c.recruiterNote.substring(0, 40) + '…' : c.recruiterNote}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {c.recruiterNote && (
                      <button
                        className="text-xs text-purple-600 border border-purple-200 bg-purple-50 px-2 py-1 rounded hover:bg-purple-100"
                        onClick={() => regenerateCandidate.mutate(c.id)}
                        disabled={regenerateCandidate.isPending || c.status === 'GENERATING'}
                      >
                        {c.status === 'GENERATING' ? 'Generating…' : '↺ Regenerate with note'}
                      </button>
                    )}
                    {c.emails.some(e => e.approved)
                      ? <span className="text-xs text-green-600 font-medium">✓ 1 approved</span>
                      : <span className="text-xs text-gray-400">none approved</span>
                    }
                  </div>
                </div>

                {c.emails.length > 0 ? (
                  <div className="divide-y divide-gray-100">
                    {c.emails.map((email, idx) => (
                      <div key={email.id}>
                        <div className={`px-4 pt-3 text-xs font-medium ${email.approved ? 'text-green-600 bg-green-50' : 'text-gray-400'}`}>
                          Variant {idx + 1}
                        </div>
                        <EmailReviewCard
                          email={email}
                          onApprove={(approved) => handleApprove(c.id, email.id, approved)}
                          onEdit={(subject, body) => editEmail.mutate({ emailId: email.id, subject, body })}
                          onRestyle={(style) => restyleEmail.mutate({ emailId: email.id, style })}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-4 text-sm text-gray-400 italic">No emails generated yet</div>
                )}
              </div>
            ))}

            </>);
            })()}
          </div>
        )}

        {/* Tab: Send */}
        {tab === 'send' && (
          <div className="space-y-4">
            <div className="card p-5 space-y-4">
              <h2 className="font-semibold">Send Emails</h2>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div className="p-3 bg-gray-50 rounded-lg">
                  <div className="text-2xl font-bold text-green-600">{approvedCount}</div>
                  <div className="text-xs text-gray-500 mt-1">Approved emails</div>
                </div>
                <div className="p-3 bg-gray-50 rounded-lg">
                  <div className="text-2xl font-bold text-sky-600">{candidatesWithEmail}</div>
                  <div className="text-xs text-gray-500 mt-1">With email address</div>
                </div>
                <div className="p-3 bg-gray-50 rounded-lg">
                  <div className="text-2xl font-bold text-gray-600">{pendingCandidates.length - candidatesWithEmail}</div>
                  <div className="text-xs text-gray-500 mt-1">Missing email</div>
                </div>
              </div>

              {pendingCandidates.filter(c => !c.email).length > 0 && (
                <div className="bg-orange-50 border border-orange-200 text-orange-800 text-sm p-3 rounded-lg">
                  {pendingCandidates.filter(c => !c.email).length} candidate(s) have no email address and will be skipped.
                </div>
              )}

              <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 text-sm p-3 rounded-lg">
                <strong>Before sending:</strong> Only approved emails will be sent. Each candidate receives one email (the first approved variant). Make sure SMTP is configured in Settings.
              </div>

              <button
                className="btn-primary"
                onClick={() => { if (confirm(`Send ${approvedCount} approved emails to ${candidatesWithEmail} candidates?`)) send.mutate(false); }}
                disabled={approvedCount === 0 || send.isPending}
              >
                {send.isPending ? d.sending : `${d.sendAll} (${approvedCount})`}
              </button>
              {send.isError && !cooldownWarnings.length && (
                <p className="text-red-600 text-sm">{(send.error as any)?.response?.data?.error}</p>
              )}

              {cooldownWarnings.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-3">
                  <p className="text-amber-800 font-medium text-sm">⚠️ Cooldown period active for {cooldownWarnings.length} recipient(s)</p>
                  <p className="text-amber-700 text-xs">These candidates were contacted within the last 90 days:</p>
                  <ul className="space-y-1">
                    {cooldownWarnings.map((w) => (
                      <li key={w.email} className="text-xs text-amber-700 flex items-center gap-2">
                        <span className="font-medium">{w.email}</span>
                        <span className="text-amber-500">— {w.daysAgo} days ago via "{w.campaignName}"</span>
                      </li>
                    ))}
                  </ul>
                  <div className="flex gap-2">
                    <button className="btn-secondary text-xs" onClick={() => setCooldownWarnings([])}>Cancel</button>
                    <button
                      className="text-xs px-3 py-1.5 rounded-lg bg-amber-600 text-white hover:bg-amber-700 font-medium"
                      onClick={() => send.mutate(true)}
                      disabled={send.isPending}
                    >
                      {send.isPending ? 'Sending...' : 'Send Anyway (ignore cooldown)'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {sendResults.length > 0 && (
              <div className="card overflow-hidden">
                <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 font-medium text-sm">Send Results</div>
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-4 py-2.5 font-medium text-gray-600">To</th>
                      <th className="text-left px-4 py-2.5 font-medium text-gray-600">Status</th>
                      <th className="text-left px-4 py-2.5 font-medium text-gray-600">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {sendResults.map((r, i) => (
                      <tr key={i}>
                        <td className="px-4 py-2.5">{r.toEmail || '—'}</td>
                        <td className="px-4 py-2.5"><span className={STATUS_BADGE[r.status] || 'badge-pending'}>{r.status}</span></td>
                        <td className="px-4 py-2.5 text-gray-500 text-xs">{r.error || ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Re-generate request modal */}
      {regenModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6 space-y-4">
            <div className="flex items-start gap-3">
              <span className="text-2xl">⚠️</span>
              <div>
                <h3 className="font-semibold text-gray-900">重要提醒</h3>
                <p className="text-sm text-gray-600 mt-1">
                  <span className="font-medium text-orange-600">「{regenModal.name}」</span> 已成功发送过邮件。
                  重复联系可能影响候选人体验，请谨慎操作。
                </p>
                <p className="text-sm text-gray-500 mt-1">
                  提交申请后，将开始 <span className="font-medium">1小时冷却期</span>，冷却结束后才可在生成步骤中勾选该人选。
                </p>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">重新生成的原因 <span className="text-red-500">*</span></label>
              <textarea
                className="input resize-none w-full"
                rows={3}
                placeholder="请说明为什么需要重新联系该候选人（必填）..."
                value={regenReason}
                onChange={e => setRegenReason(e.target.value)}
                autoFocus
              />
            </div>
            <div className="flex gap-3">
              <button
                className="btn-primary flex-1 bg-red-500 hover:bg-red-600"
                disabled={regenReason.trim().length < 5 || requestRegen.isPending}
                onClick={() => requestRegen.mutate({ candidateId: regenModal.candidateId, reason: regenReason })}
              >
                {requestRegen.isPending ? '提交中...' : '确认申请（1小时冷却后可生成）'}
              </button>
              <button className="btn-secondary" onClick={() => { setRegenModal(null); setRegenReason(''); }}>取消</button>
            </div>
            {requestRegen.isError && (
              <p className="text-xs text-red-500">{(requestRegen.error as any)?.response?.data?.error}</p>
            )}
          </div>
        </div>
      )}
    </AppLayout>
  );
}
