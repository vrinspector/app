import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Mail, UserPlus, Users, X } from "lucide-react"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"

import {
  type EmailLogPublic,
  EmailsService,
  type MemberPublic,
  ProjectsService,
} from "@/client"
import { ConfirmDialog } from "@/components/Common/ConfirmDialog"
import { EmptyState, QueryState } from "@/components/Common/States"
import { StatusBadge } from "@/components/Common/StatusBadge"
import { Button } from "@/components/ui/button"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { LoadingButton } from "@/components/ui/loading-button"
import { NativeSelect } from "@/components/ui/native-select"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { findOwnMembership } from "@/hooks/useProjectRole"
import { formatDate } from "@/lib/format"
import { inviteEmailsQuery, membersQuery, projectKeys } from "@/lib/queries"
import { extractErrorMessage } from "@/utils"

/*
 * The legacy "Project Members" modal (`openMembersModal` / `loadMembers` /
 * `submitInvite` / `removeMember`) as a section of the project screen: the
 * member list with role badges, a remove button on every non-owner row
 * (owners only), and "Invite by email" with the legacy role select
 * (Inspector / Viewer). Same requests:
 *
 *   GET    /projects/{id}/members
 *   POST   /projects/{id}/members {email, role}      → 201 (409 if already a member)
 *   DELETE /projects/{id}/members/{member_id}        → 204 (owners cannot be removed)
 *
 * The API records `invited_by` from the verified identity and sends a 403 to
 * a non-owner, so the buttons are hidden for inspectors and viewers rather
 * than relied on.
 *
 * Increment 13.5: adding a member also emails them an invite. Owners see
 * each invite's outcome under the member ("Invite emailed …", "Invite email
 * failed", "Email is off on this server") from the owner-only send log, and
 * can send it again with "Resend invite" until the person signs in:
 *
 *   GET  /projects/{id}/emails?email_type=member_invite   (owner)
 *   POST /projects/{id}/members/{member_id}/invite-email  → 202 (429 if just sent)
 */

const INVITE_ROLES = [
  { value: "inspector", label: "Inspector" },
  { value: "viewer", label: "Viewer" },
] as const

const schema = z.object({
  email: z.email("Enter a valid email address").trim().max(255),
  role: z.enum(["inspector", "viewer"]),
})

type FormValues = z.infer<typeof schema>

interface MembersSectionProps {
  projectId: number
  canManage: boolean
}

export function MembersSection({ projectId, canManage }: MembersSectionProps) {
  const query = useQuery(membersQuery(projectId))

  return (
    <section aria-labelledby="members-heading" className="flex flex-col gap-3">
      <QueryState
        query={query}
        errorTitle="Couldn't load the members"
        empty={
          <>
            <h2 id="members-heading" className="text-lg font-semibold">
              Members <span className="text-muted-foreground">(0)</span>
            </h2>
            <EmptyState
              icon={<Users />}
              title="No members yet"
              description="Invite the people who need to see or work on this project."
              className="py-8"
            />
          </>
        }
      >
        {(members) => (
          <MemberList
            projectId={projectId}
            members={members}
            canManage={canManage}
          />
        )}
      </QueryState>
      {canManage ? <InviteForm projectId={projectId} /> : null}
    </section>
  )
}

interface MemberListProps {
  projectId: number
  members: MemberPublic[]
  canManage: boolean
}

function MemberList({ projectId, members, canManage }: MemberListProps) {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [removing, setRemoving] = useState<MemberPublic | null>(null)
  const own = findOwnMembership(members, user)
  const invites = useQuery({
    ...inviteEmailsQuery(projectId),
    enabled: canManage,
  })
  const latestInvite = latestInviteByMember(invites.data)

  const resendMutation = useMutation({
    mutationFn: (member: MemberPublic) =>
      EmailsService.resendMemberInvite({
        path: { project_id: projectId, member_id: member.id },
      }),
    onSuccess: (_data, member) => {
      showSuccessToast(
        `Invite sent again to ${member.email ?? member.user_email}`,
      )
      queryClient.invalidateQueries({
        queryKey: projectKeys.inviteEmails(projectId),
      })
    },
    onError: (error: Error) => showErrorToast(extractErrorMessage(error)),
  })

  const removeMutation = useMutation({
    mutationFn: (member: MemberPublic) =>
      ProjectsService.removeMember({
        path: { project_id: projectId, member_id: member.id },
      }),
    onSuccess: () => {
      showSuccessToast("Member removed")
      setRemoving(null)
      queryClient.invalidateQueries({
        queryKey: projectKeys.members(projectId),
      })
    },
    onError: (error: Error) => {
      setRemoving(null)
      showErrorToast(extractErrorMessage(error))
    },
  })

  return (
    <>
      <h2 id="members-heading" className="text-lg font-semibold">
        Members{" "}
        <span className="text-muted-foreground" data-testid="members-count">
          ({members.length})
        </span>
      </h2>
      <ul
        className="divide-y rounded-lg border bg-card"
        data-testid="member-list"
      >
        {members.map((member) => {
          const email = member.email ?? member.user_email
          const isSelf = own?.id === member.id
          return (
            <li
              key={member.id}
              data-testid="member-row"
              className="flex items-center gap-3 px-4 py-2.5"
            >
              <StatusBadge
                value={member.role}
                tone={member.role === "owner" ? "settled" : "neutral"}
                className={
                  member.role === "owner"
                    ? "bg-vri-green text-vri-offwhite"
                    : "bg-vri-copper text-white"
                }
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">
                  {email}
                  {isSelf ? (
                    <span className="text-muted-foreground"> (you)</span>
                  ) : null}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {member.user_sub
                    ? "Signed in"
                    : "Invited — has not signed in yet"}
                  {member.created_at
                    ? ` · ${formatDate(member.created_at)}`
                    : ""}
                  {member.invited_by ? ` · by ${member.invited_by}` : ""}
                </p>
                {canManage && member.role !== "owner" ? (
                  <InviteEmailStatus row={latestInvite.get(member.id)} />
                ) : null}
              </div>
              {canManage && member.role !== "owner" && !member.user_sub ? (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Resend invite to ${email}`}
                  data-testid="resend-invite"
                  disabled={
                    resendMutation.isPending &&
                    resendMutation.variables?.id === member.id
                  }
                  onClick={() => resendMutation.mutate(member)}
                >
                  <Mail />
                  <span className="hidden sm:inline">Resend invite</span>
                </Button>
              ) : null}
              {canManage && member.role !== "owner" ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive hover:text-destructive"
                  aria-label={`Remove ${email}`}
                  onClick={() => setRemoving(member)}
                >
                  <X />
                </Button>
              ) : null}
            </li>
          )
        })}
      </ul>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null)
        }}
        title="Remove this member?"
        description={
          <>
            <strong>{removing?.email ?? removing?.user_email}</strong> will lose
            access to this project and everything in it. They can be invited
            again later.
          </>
        }
        confirmLabel="Remove member"
        variant="destructive"
        pending={removeMutation.isPending}
        onConfirm={() => {
          if (removing) removeMutation.mutate(removing)
        }}
      />
    </>
  )
}

/** Newest invite-log row per member id (the API returns newest first). */
function latestInviteByMember(
  rows: EmailLogPublic[] | undefined,
): Map<number, EmailLogPublic> {
  const latest = new Map<number, EmailLogPublic>()
  for (const row of rows ?? []) {
    if (row.related_id != null && !latest.has(row.related_id)) {
      latest.set(row.related_id, row)
    }
  }
  return latest
}

function InviteEmailStatus({ row }: { row: EmailLogPublic | undefined }) {
  if (!row) return null
  let text: string
  let className = "text-muted-foreground"
  switch (row.status) {
    case "sent":
      text = `Invite emailed ${formatDate(row.sent_at ?? row.created_at)}`
      break
    case "queued":
      text = "Sending invite email…"
      break
    case "failed":
      text = "Invite email failed — try Resend invite"
      className = "text-destructive"
      break
    default:
      text = "Invite not emailed — email is off on this server"
  }
  return (
    <p
      className={`truncate text-xs ${className}`}
      data-testid="invite-email-status"
      data-status={row.status}
      title={row.error ?? undefined}
    >
      {text}
    </p>
  )
}

function InviteForm({ projectId }: { projectId: number }) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", role: "inspector" },
  })

  const inviteMutation = useMutation({
    mutationFn: (values: FormValues) =>
      ProjectsService.inviteMember({
        path: { project_id: projectId },
        body: { email: values.email, role: values.role },
      }),
    onSuccess: () => {
      showSuccessToast("Member added — invite email on its way")
      form.reset({ email: "", role: form.getValues("role") })
      queryClient.invalidateQueries({
        queryKey: projectKeys.members(projectId),
      })
      queryClient.invalidateQueries({
        queryKey: projectKeys.inviteEmails(projectId),
      })
    },
    onError: (error: Error) => showErrorToast(extractErrorMessage(error)),
  })

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((values) => inviteMutation.mutate(values))}
        noValidate
        className="flex flex-col gap-3 rounded-lg border bg-card p-4"
        data-testid="invite-form"
        aria-labelledby="invite-heading"
      >
        <h3 id="invite-heading" className="text-sm font-semibold">
          Invite by email
        </h3>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem className="flex-1">
                <FormLabel className="sr-only">Email address</FormLabel>
                <FormControl>
                  <Input
                    type="email"
                    inputMode="email"
                    autoComplete="off"
                    placeholder="user@example.com"
                    data-testid="invite-email"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="role"
            render={({ field }) => (
              <FormItem className="sm:w-40">
                <FormLabel className="sr-only">Role</FormLabel>
                <FormControl>
                  <NativeSelect data-testid="invite-role" {...field}>
                    {INVITE_ROLES.map((role) => (
                      <option key={role.value} value={role.value}>
                        {role.label}
                      </option>
                    ))}
                  </NativeSelect>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <LoadingButton
            type="submit"
            loading={inviteMutation.isPending}
            data-testid="send-invite"
          >
            <UserPlus />
            Send invite
          </LoadingButton>
        </div>
        <p className="text-xs text-muted-foreground">
          Inspectors log inspections, findings and photos; viewers can only
          read. We email the person an invite with a link to the project; they
          sign in with this email address.
        </p>
      </form>
    </Form>
  )
}
