"use client";

import { useId, useRef, useState } from "react";
import { Copy, Link2, LoaderCircle, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { AnalysisResult } from "@/lib/schema";
import { buildShareRequest, describeShareStatus, describeStopStatus, isMemoryStore, NETWORK_ERROR, type Outcome, type ShareCreated } from "./request";

const checkCls = "flex min-h-11 cursor-pointer items-start gap-3 rounded-md py-2";
const boxCls = "mt-1 size-5 shrink-0 accent-primary";

export function ShareControl({ result }: { result: AnalysisResult | null }): React.JSX.Element {
  const id = useId();
  const [consent, setConsent] = useState(false);
  const [firstNameOnly, setFirstNameOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  // revokeToken lives only in this state — never in storage or the URL.
  const [share, setShare] = useState<ShareCreated | null>(null);
  const [notice, setNotice] = useState<Outcome | null>(null);
  const [copied, setCopied] = useState(false);
  const linkRef = useRef<HTMLInputElement>(null);

  const link = share ? window.location.origin + share.url : "";

  async function create() {
    if (!result || !consent) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildShareRequest(result, firstNameOnly)),
      });
      if (res.status === 201) {
        setShare((await res.json()) as ShareCreated);
        setCopied(false);
      } else setNotice(describeShareStatus(res.status));
    } catch {
      setNotice(NETWORK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    if (!share) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/plans/${encodeURIComponent(share.id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${share.revokeToken}` },
      });
      const outcome = describeStopStatus(res.status);
      setNotice(outcome);
      if (outcome.kind === "ok") {
        setShare(null);
        setConsent(false);
      }
    } catch {
      setNotice(NETWORK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      // Fallback: select the text so the user can copy it by hand.
      linkRef.current?.focus();
      linkRef.current?.select();
    }
  }

  const noticeEl = notice && (
    <p
      role={notice.kind === "ok" ? "status" : "alert"}
      className={`rounded-md border px-3 py-2 ${notice.kind === "ok" ? "border-border bg-muted" : "border-destructive/40 bg-destructive/10 text-destructive"}`}
    >
      {notice.message}
    </p>
  );

  return (
    <Card className="print:hidden">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <Share2 className="size-5" aria-hidden="true" />
          Share with family
        </CardTitle>
        <CardDescription className="text-base">A read-only link to this week&apos;s activities and days.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-base">
        {!result ? (
          <p className="text-muted-foreground">Make a plan first — then you can share it.</p>
        ) : share ? (
          <>
            <label htmlFor={`${id}-link`} className="font-medium">
              Share link
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                id={`${id}-link`}
                ref={linkRef}
                readOnly
                value={link}
                onFocus={(e) => e.currentTarget.select()}
                className="min-h-11 w-full min-w-0 rounded-md border bg-background px-3 py-2 text-base"
              />
              <Button size="lg" className="min-h-11" onClick={copy}>
                <Copy aria-hidden="true" /> {copied ? "Copied" : "Copy link"}
              </Button>
            </div>
            <p role="status">{copied ? "Link copied to clipboard." : ""}</p>
            <p>
              Expires{" "}
              <time dateTime={share.expiresAt}>{new Date(share.expiresAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</time>.
            </p>
            {isMemoryStore(share) && <p className="text-muted-foreground">Demo link: it only works while this demo server is running.</p>}
            <Button variant="destructive" size="lg" className="min-h-11 self-start" onClick={stop} disabled={busy}>
              {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Link2 aria-hidden="true" />}
              Stop sharing
            </Button>
            {noticeEl}
          </>
        ) : (
          <>
            <label className={checkCls}>
              <input type="checkbox" className={boxCls} checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>I agree to share a read-only summary of this plan (activities and days only — no health, mobility, budget or contacts)</span>
            </label>
            <label className={checkCls}>
              <input type="checkbox" role="switch" className={boxCls} checked={firstNameOnly} onChange={(e) => setFirstNameOnly(e.target.checked)} />
              <span>Show first name</span>
            </label>
            <Button size="lg" className="min-h-11 self-start" onClick={create} disabled={!consent || busy} aria-describedby={consent ? undefined : `${id}-why`}>
              {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Share2 aria-hidden="true" />}
              {busy ? "Creating link…" : "Share"}
            </Button>
            {!consent && (
              <p id={`${id}-why`} className="text-sm text-muted-foreground">
                Tick the box above to enable sharing.
              </p>
            )}
            {noticeEl}
          </>
        )}
      </CardContent>
    </Card>
  );
}
