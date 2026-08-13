"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DEFAULT_EMAIL_BODY_HTML,
  DEFAULT_EMAIL_SUBJECT,
} from "@/lib/email-default-template";

interface TemplateSeed {
  id: string;
  locale: string;
  displayName: string;
  fromAddress: string | null;
  fromName: string | null;
  subject: string;
  bodyHtml: string;
}

interface CommonProps {
  productId: string;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}

type Props =
  | (CommonProps & { mode: "create" })
  | (CommonProps & { mode: "edit"; template: TemplateSeed });

/**
 * Add or edit a per-language email template. Locale is locked in edit mode
 * (renaming a locale is logically a delete + create).
 */
export function TemplateFormDialog(props: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [inFlight, setInFlight] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = props.mode === "edit";
  const editing = isEdit ? props.template : null;

  // Form state is keyed by dialog open transitions: reset every time the
  // dialog opens. That way editing then creating pre-fills each with the
  // right starting values. Default content comes from the canonical
  // email-default-template module so the seed stays in sync everywhere.
  const initial = editing ?? {
    locale: "",
    displayName: "",
    fromAddress: "" as string | null,
    fromName: "" as string | null,
    subject: DEFAULT_EMAIL_SUBJECT,
    bodyHtml: DEFAULT_EMAIL_BODY_HTML,
  };

  const [locale, setLocale] = useState(initial.locale);
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [fromAddress, setFromAddress] = useState<string>(initial.fromAddress ?? "");
  const [fromName, setFromName] = useState<string>(initial.fromName ?? "");
  const [subject, setSubject] = useState(initial.subject);
  const [bodyHtml, setBodyHtml] = useState(initial.bodyHtml);

  const busy = inFlight || pending;

  function resetFromProps() {
    setLocale(initial.locale);
    setDisplayName(initial.displayName);
    setFromAddress(initial.fromAddress ?? "");
    setFromName(initial.fromName ?? "");
    setSubject(initial.subject);
    setBodyHtml(initial.bodyHtml);
    setError(null);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const localeClean = locale.trim().toLowerCase();
    if (!/^[a-z]{2,3}$/.test(localeClean)) {
      setError("Locale must be 2–3 lowercase letters (e.g. en, zh, ja)");
      return;
    }

    setInFlight(true);
    try {
      const url = isEdit
        ? `/api/products/${props.productId}/templates/${editing!.id}`
        : `/api/products/${props.productId}/templates`;
      const method = isEdit ? "PATCH" : "POST";
      const payload = isEdit
        ? {
            displayName,
            fromAddress: fromAddress.trim() || null,
            fromName: fromName.trim() || null,
            subject,
            bodyHtml,
          }
        : {
            locale: localeClean,
            displayName,
            fromAddress: fromAddress.trim() || null,
            fromName: fromName.trim() || null,
            subject,
            bodyHtml,
          };

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Error ${res.status}`);
        return;
      }

      toast.success(isEdit ? "Template updated" : "Template added");
      props.onOpenChange(false);
      startTransition(() => router.refresh());
    } finally {
      setInFlight(false);
    }
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={(next) => {
        if (next) resetFromProps();
        props.onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>
            {isEdit
              ? `Edit ${editing!.displayName} template`
              : "Add language"}
          </DialogTitle>
          <DialogDescription>
            Each template can have its own from-address. Use{" "}
            <code className="font-mono">{`{{xxx}}`}</code> for system-filled
            values and <code className="font-mono">[[xxx]]</code> for hints you
            must replace before sending. Supported:{" "}
            <code className="font-mono">{`{{code}}`}</code>,{" "}
            <code className="font-mono">{`{{orderId}}`}</code>,{" "}
            <code className="font-mono">{`{{email}}`}</code>,{" "}
            <code className="font-mono">{`{{productName}}`}</code>,{" "}
            <code className="font-mono">{`{{plan}}`}</code>,{" "}
            <code className="font-mono">{`{{maxActivations}}`}</code>,{" "}
            <code className="font-mono">{`{{supportEmail}}`}</code>.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="tpl-locale">Locale</Label>
              <Input
                id="tpl-locale"
                value={locale}
                onChange={(e) => setLocale(e.target.value.toLowerCase())}
                disabled={isEdit}
                readOnly={isEdit}
                placeholder="zh"
                required
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">
                2–3 lowercase letters. Paddle&apos;s{" "}
                <code className="font-mono">zh-CN</code> matches{" "}
                <code className="font-mono">zh</code>.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="tpl-name">Display name</Label>
              <Input
                id="tpl-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="简体中文"
                required
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="tpl-from-name">From name</Label>
              <Input
                id="tpl-from-name"
                value={fromName}
                onChange={(e) => setFromName(e.target.value)}
                placeholder="Licentra"
              />
              <p className="text-xs text-muted-foreground">
                Optional. Display name shown to the recipient.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="tpl-from">From address</Label>
              <Input
                id="tpl-from"
                value={fromAddress}
                onChange={(e) => setFromAddress(e.target.value)}
                placeholder="noreply@henri.ren"
              />
              <p className="text-xs text-muted-foreground">
                Optional. Email address; the domain must be verified in
                Resend.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tpl-subject">Subject</Label>
            <Input
              id="tpl-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="tpl-body">Body HTML</Label>
            <textarea
              id="tpl-body"
              value={bodyHtml}
              onChange={(e) => setBodyHtml(e.target.value)}
              rows={10}
              required
              className="flex min-h-[160px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring font-mono"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => props.onOpenChange(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Spinner />}
              {busy
                ? isEdit
                  ? "Saving…"
                  : "Adding…"
                : isEdit
                  ? "Save changes"
                  : "Add template"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
