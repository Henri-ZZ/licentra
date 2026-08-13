"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";

import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { TemplateFormDialog } from "@/app/(dashboard)/dashboard/products/[id]/template-form-dialog";
import { DeleteTemplateButton } from "@/app/(dashboard)/dashboard/products/[id]/delete-template-button";

interface Template {
  id: string;
  locale: string;
  displayName: string;
  isDefault: boolean;
  fromAddress: string | null;
  fromName: string | null;
  subject: string;
  bodyHtml: string;
}

interface Props {
  productId: string;
  templates: Template[];
}

/**
 * Per-language email templates for a Product.
 *
 * `en` is mandatory and un-deletable. Other locales can be added freely.
 * On send, pickTemplate matches the customer's Paddle locale (prefix)
 * against this list; missing locales fall back to `en`.
 */
export function ProductTemplatesCard({
  productId,
  templates,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // The list is sorted: default first, then alphabetical by locale.
  const sorted = [...templates].sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    return a.locale.localeCompare(b.locale);
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="space-y-1.5">
          <CardTitle>Email templates</CardTitle>
          <CardDescription>
            One template per language. Paddle sends a checkout locale like{" "}
            <code className="font-mono">zh-CN</code> — we match it by prefix to
            the right template, falling back to the default (English) when
            nothing matches.
          </CardDescription>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="size-4" />
          Add language
        </Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[80px]">Locale</TableHead>
              <TableHead>Name</TableHead>
              <TableHead className="w-[80px]">Default</TableHead>
              <TableHead>Subject</TableHead>
              <TableHead className="w-[160px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((t) => (
              <TemplateRow
                key={t.id}
                template={t}
                productId={productId}
                busyId={busyId}
                setBusyId={setBusyId}
                onMutated={() => startTransition(() => router.refresh())}
              />
            ))}
          </TableBody>
        </Table>

        {templates.length === 0 && (
          <p className="text-sm text-muted-foreground py-4">
            No templates yet. A default <code className="font-mono">en</code>{" "}
            template is created automatically — if you don&apos;t see one, run{" "}
            <code className="font-mono">pnpm backfill:templates</code>.
          </p>
        )}

        {pending && (
          <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1">
            <Spinner className="size-3" />
            Refreshing…
          </p>
        )}
      </CardContent>

      <TemplateFormDialog
        productId={productId}
        mode="create"
        open={open}
        onOpenChange={setOpen}
      />
    </Card>
  );
}

interface RowProps {
  template: Template;
  productId: string;
  busyId: string | null;
  setBusyId: (id: string | null) => void;
  onMutated: () => void;
}

function TemplateRow({
  template,
  productId,
  busyId,
  setBusyId,
  onMutated,
}: RowProps) {
  const [editOpen, setEditOpen] = useState(false);
  const isProtected = template.locale === "en" && template.isDefault;
  const isBusy = busyId === template.id;

  return (
    <TableRow>
      <TableCell className="font-mono text-xs">{template.locale}</TableCell>
      <TableCell>{template.displayName}</TableCell>
      <TableCell>
        {template.isDefault ? (
          <Badge variant="success">default</Badge>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground max-w-[280px] truncate">
        {template.subject}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditOpen(true)}
            disabled={isBusy}
          >
            Edit
          </Button>
          <DeleteTemplateButton
            productId={productId}
            template={template}
            isProtected={isProtected}
            onBusyChange={(b) => setBusyId(b ? template.id : null)}
            onDeleted={onMutated}
          />
        </div>
      </TableCell>

      <TemplateFormDialog
        productId={productId}
        mode="edit"
        template={template}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
    </TableRow>
  );
}
