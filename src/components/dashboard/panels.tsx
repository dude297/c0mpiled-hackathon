"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import type { AnalysisResult } from "@/lib/schema";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-6xl p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Hackathon Starter</h1>
        <p className="text-sm text-muted-foreground">Scenario → deterministic engine → AI explanation → evidence</p>
      </header>
      <div className="grid gap-4 md:grid-cols-2">{children}</div>
    </div>
  );
}

export function ScenarioPanel(props: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  loading: boolean;
  error: string | null;
}) {
  return (
    <Card>
      <CardHeader><CardTitle>Scenario</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <Textarea rows={6} value={props.value} onChange={(e) => props.onChange(e.target.value)} placeholder="Describe a scenario..." />
        <Button onClick={props.onSubmit} disabled={props.loading}>{props.loading ? "Running..." : "Run"}</Button>
        {props.error && <p className="text-sm text-destructive">{props.error}</p>}
      </CardContent>
    </Card>
  );
}

export function ResultPanel({ result }: { result: AnalysisResult | null }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Result {result && <Badge variant={result.dataSource === "mock" ? "secondary" : "default"}>{result.dataSource}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {!result ? <p className="text-muted-foreground">No result yet.</p> : (
          <>
            <p className="font-medium">{result.summary}</p>
            <ul>{result.items.map((it) => <li key={it.label}>{it.label}: <b>{it.value}</b></li>)}</ul>
            <p className="text-muted-foreground">{result.explanation}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function EvidencePanel({ result }: { result: AnalysisResult | null }) {
  return (
    <Card className="md:col-span-2">
      <CardHeader><CardTitle>Evidence / Verification</CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm">
        {!result?.evidence.length ? <p className="text-muted-foreground">No evidence yet.</p> :
          result.evidence.map((e, i) => (
            <div key={i} className="flex items-start gap-2">
              <Badge variant={e.verified ? "default" : "destructive"}>{e.verified ? "verified" : "unverified"}</Badge>
              <span>{e.claim} <span className="text-muted-foreground">({e.source})</span></span>
            </div>
          ))}
      </CardContent>
    </Card>
  );
}
