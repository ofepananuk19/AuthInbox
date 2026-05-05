import { useEffect, useMemo, useState } from 'react';
import DOMPurify from 'dompurify';
import { Inbox, RefreshCw, ShieldCheck } from 'lucide-react';
import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import { Card, CardHeader, CardTitle } from './components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs';
import { cn } from './lib/utils';

const PAGE_SIZE = 20;
interface MailListItem {
	id: number;
	messageId: string | null;
	fromOrg: string | null;
	fromAddr: string | null;
	toAddr: string | null;
	topic: string | null;
	code: string | null;
	createdAt: string | null;
	subject: string | null;
}

interface MailListResponse {
	page: number;
	pageSize: number;
	total: number;
	items: MailListItem[];
}

interface MailDetail {
	id: number;
	messageId: string | null;
	fromOrg: string | null;
	fromAddr: string | null;
	toAddr: string | null;
	subject: string | null;
	topic: string | null;
	code: string | null;
	createdAt: string | null;
	raw: string | null;
	textBody: string | null;
	htmlBody: string | null;
}

function formatDate(value: string | null): string {
	if (!value) {
		return '-';
	}
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function toPreviewHtml(htmlBody: string, hideRemoteImages: boolean): string {
	const sanitized = DOMPurify.sanitize(htmlBody, {
		USE_PROFILES: { html: true },
		FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form'],
		FORBID_ATTR: ['onerror', 'onload', 'onclick'],
	});

	const doc = new DOMParser().parseFromString(sanitized, 'text/html');
	if (hideRemoteImages) {
		doc.querySelectorAll('img').forEach((img) => img.remove());
	}
	doc.querySelectorAll('a').forEach((anchor) => {
		anchor.setAttribute('target', '_blank');
		anchor.setAttribute('rel', 'noopener noreferrer');
	});

	return `<!doctype html>
<html>
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<style>
		body { margin: 0; padding: 20px; font-family: "Manrope", sans-serif; color: #e5e5e5; background: #000000; line-height: 1.5; }
		a { color: #5fe0c0; }
		pre { white-space: pre-wrap; word-break: break-word; }
		img { max-width: 100%; height: auto; border-radius: 8px; }
	</style>
</head>
<body>${doc.body.innerHTML}</body>
</html>`;
}

async function fetchJson<T>(url: string): Promise<T> {
	const response = await fetch(url, {
		headers: {
			Accept: 'application/json',
		},
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(text || `Request failed (${response.status})`);
	}
	return (await response.json()) as T;
}

function App(): JSX.Element {
	const [page, setPage] = useState(1);
	const [list, setList] = useState<MailListResponse>({ page: 1, pageSize: PAGE_SIZE, total: 0, items: [] });
	const [isListLoading, setIsListLoading] = useState(true);
	const [listError, setListError] = useState<string | null>(null);
	const [selectedMailId, setSelectedMailId] = useState<number | null>(null);

	const [detail, setDetail] = useState<MailDetail | null>(null);
	const [isDetailLoading, setIsDetailLoading] = useState(false);
	const [detailError, setDetailError] = useState<string | null>(null);
	const [hideRemoteImages, setHideRemoteImages] = useState(true);

	const totalPages = Math.max(1, Math.ceil(list.total / PAGE_SIZE));

	const refreshList = (): void => {
		setIsListLoading(true);
		setListError(null);
		fetchJson<MailListResponse>(`/api/mails?page=${page}&pageSize=${PAGE_SIZE}`)
			.then((payload) => {
				setList(payload);
				setSelectedMailId((previousId) => {
					if (previousId && payload.items.some((item) => item.id === previousId)) {
						return previousId;
					}
					return payload.items[0]?.id ?? null;
				});
			})
			.catch((error: unknown) => {
				setListError(error instanceof Error ? error.message : 'Unable to load mail list.');
			})
			.finally(() => {
				setIsListLoading(false);
			});
	};

	useEffect(() => {
		refreshList();
	}, [page]);

	useEffect(() => {
		if (!selectedMailId) {
			setDetail(null);
			return;
		}
		setHideRemoteImages(true);
		setDetailError(null);
		setIsDetailLoading(true);

		fetchJson<MailDetail>(`/api/mails/${selectedMailId}`)
			.then((payload) => {
				setDetail(payload);
			})
			.catch((error: unknown) => {
				setDetailError(error instanceof Error ? error.message : 'Unable to load mail details.');
			})
			.finally(() => {
				setIsDetailLoading(false);
			});
	}, [selectedMailId]);

	const previewHtml = useMemo(() => {
		if (!detail?.htmlBody) {
			return null;
		}
		return toPreviewHtml(detail.htmlBody, hideRemoteImages);
	}, [detail?.htmlBody, hideRemoteImages]);

	return (
		<div className="min-h-screen bg-background text-slate-100">
			<div className="pointer-events-none fixed inset-0 bg-[radial-gradient(1200px_500px_at_10%_0%,rgba(95,224,192,0.08),transparent)]" />
			<main className="relative mx-auto w-full max-w-[1300px] px-4 pb-8 pt-6 lg:px-8">
				<header className="mb-6 flex flex-wrap items-end justify-between gap-4">
					<div>
						<div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">
							<ShieldCheck className="h-4 w-4" />
							Private Mail Console
						</div>
						<h1 className="font-sans text-3xl font-bold text-slate-100">Auth Inbox</h1>
						<p className="mt-1 text-sm text-muted-foreground">Verification messages, raw source, and sanitized HTML preview.</p>
					</div>
					<div className="flex items-center gap-2">
						<Badge>{list.total} Entries</Badge>
						<Button variant="outline" onClick={refreshList} className="gap-2">
							<RefreshCw className="h-4 w-4" />
							Refresh
						</Button>
					</div>
				</header>

				<div className="grid gap-6 lg:grid-cols-[1.15fr_1fr] [&>*]:min-w-0">
					<Card>
						<CardHeader>
							<CardTitle className="flex items-center gap-2">
								<Inbox className="h-4 w-4 text-primary" />
								Mail List
							</CardTitle>
							<div className="text-xs text-muted-foreground">Page {page} / {totalPages}</div>
						</CardHeader>

						{listError ? <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">{listError}</div> : null}

						<div className="overflow-hidden rounded-xl border border-border/80">
							<div className="max-h-[640px] overflow-auto">
								<table className="w-full border-collapse text-sm">
									<thead className="sticky top-0 bg-[#111111] text-left text-xs uppercase tracking-[0.08em] text-muted-foreground">
										<tr>
											<th className="px-3 py-3">From</th>
											<th className="hidden px-3 py-3 sm:table-cell">To</th>
											<th className="px-3 py-3">Subject / Topic</th>
											<th className="hidden px-3 py-3 sm:table-cell">Time</th>
										</tr>
									</thead>
									<tbody className="divide-y divide-border/80">
										{isListLoading ? (
											Array.from({ length: 6 }).map((_, index) => (
												<tr key={`skeleton-${index}`} className="animate-pulse">
													<td className="px-3 py-3"><div className="h-3 w-24 rounded bg-slate-500/30" /></td>
													<td className="hidden px-3 py-3 sm:table-cell"><div className="h-3 w-24 rounded bg-slate-500/30" /></td>
													<td className="px-3 py-3"><div className="h-3 w-56 rounded bg-slate-500/30" /></td>
													<td className="hidden px-3 py-3 sm:table-cell"><div className="h-3 w-28 rounded bg-slate-500/30" /></td>
												</tr>
											))
										) : list.items.length === 0 ? (
											<tr>
												<td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">
													No mails available.
												</td>
											</tr>
										) : (
											list.items.map((item) => {
												const active = item.id === selectedMailId;
												return (
													<tr
														key={item.id}
														className={cn(
															'cursor-pointer bg-transparent transition-colors hover:bg-[#1a1a1a]',
															active && 'bg-[#252525]'
														)}
														onClick={() => setSelectedMailId(item.id)}
													>
														<td className="max-w-[140px] truncate px-3 py-3 font-medium text-slate-100">{item.fromOrg || item.fromAddr || '-'}</td>
														<td className="hidden max-w-[130px] truncate px-3 py-3 text-slate-300 sm:table-cell">{item.toAddr || '-'}</td>
														<td className="max-w-[200px] truncate px-3 py-3 text-slate-200 sm:max-w-[320px]">{item.subject || item.topic || '-'}</td>
														<td className="hidden whitespace-nowrap px-3 py-3 text-xs text-muted-foreground sm:table-cell">{formatDate(item.createdAt)}</td>
													</tr>
												);
											})
										)}
									</tbody>
								</table>
							</div>
						</div>

						<div className="mt-4 flex items-center justify-between">
							<Button variant="ghost" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1 || isListLoading}>
								Previous
							</Button>
							<Button variant="ghost" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page >= totalPages || isListLoading}>
								Next
							</Button>
						</div>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>Mail Detail</CardTitle>
						</CardHeader>

						{detailError ? <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">{detailError}</div> : null}

						{!selectedMailId ? (
							<div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">Select one row from the list to inspect details.</div>
						) : isDetailLoading ? (
							<div className="space-y-3">
								<div className="h-4 w-1/2 animate-pulse rounded bg-slate-500/30" />
								<div className="h-4 w-full animate-pulse rounded bg-slate-500/30" />
								<div className="h-44 w-full animate-pulse rounded bg-slate-500/30" />
							</div>
						) : detail ? (
							<>
								<div className="mb-4 grid gap-2 rounded-lg border border-border/80 bg-[#111111] p-3 text-sm text-slate-300">
									<div><span className="text-muted-foreground">From:</span> {detail.fromOrg || detail.fromAddr || '-'}</div>
									<div><span className="text-muted-foreground">To:</span> {detail.toAddr || '-'}</div>
									<div><span className="text-muted-foreground">Subject:</span> {detail.subject || '-'}</div>
									<div><span className="text-muted-foreground">Received:</span> {formatDate(detail.createdAt)}</div>
								</div>

								<Tabs defaultValue="rendered">
									<TabsList>
										<TabsTrigger value="rendered">Body</TabsTrigger>
										<TabsTrigger value="raw">Source</TabsTrigger>
									</TabsList>

									<TabsContent value="raw">
										<pre className="max-h-[420px] overflow-auto rounded-lg border border-border/80 bg-[#0a0a0a] p-4 font-mono text-xs leading-6 text-slate-300">
											{detail.raw || 'No raw email payload saved.'}
										</pre>
									</TabsContent>

									<TabsContent value="rendered">
										<div className="mb-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
											<div>HTML is sanitized before preview. Plain text is shown when no HTML body exists.</div>
											<label className="inline-flex cursor-pointer items-center gap-2">
												<input
													type="checkbox"
													className="h-4 w-4 accent-primary"
													checked={hideRemoteImages}
													onChange={(event) => setHideRemoteImages(event.target.checked)}
												/>
												Hide remote images
											</label>
										</div>

										{previewHtml ? (
											<iframe
												title="mail-preview"
												sandbox=""
												srcDoc={previewHtml}
												className="h-[460px] w-full rounded-lg border border-border bg-[#000000]"
											/>
										) : detail.textBody ? (
											<pre className="max-h-[420px] overflow-auto rounded-lg border border-border/80 bg-[#0a0a0a] p-4 font-mono text-xs leading-6 text-slate-300">
												{detail.textBody}
											</pre>
										) : (
											<div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
												No renderable body found for this email.
											</div>
										)}
									</TabsContent>
								</Tabs>
							</>
						) : (
							<div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">No details loaded.</div>
						)}
					</Card>
				</div>
			</main>
		</div>
	);
}

export default App;
