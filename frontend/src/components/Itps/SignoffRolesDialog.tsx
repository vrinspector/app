import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, Save, Trash2 } from "lucide-react"
import { useEffect, useState } from "react"

import { ItpsService, type SignoffRolePublic } from "@/client"
import { QueryState } from "@/components/Common/States"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { LoadingButton } from "@/components/ui/loading-button"
import { NativeSelect } from "@/components/ui/native-select"
import useCustomToast from "@/hooks/useCustomToast"
import { PARTY_OPTIONS, type Party } from "@/lib/itp"
import { signoffRolesQuery } from "@/lib/queries"
import { extractErrorMessage } from "@/utils"

/*
 * The project's sign-off roles (owner decision 36: set once per project and
 * shared by every ITP). Importing a template creates the roles it names; the
 * owner fills in who signs for each. A role with an email is signed in the
 * app only by the member signed in with that email; one without is signed
 * by a project owner. Roles that lines still need cannot be deleted.
 */

interface SignoffRolesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: number
  canManage: boolean
}

export function SignoffRolesDialog({
  open,
  onOpenChange,
  projectId,
  canManage,
}: SignoffRolesDialogProps) {
  const query = useQuery({ ...signoffRolesQuery(projectId), enabled: open })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl"
        data-testid="signoff-roles-dialog"
      >
        <DialogHeader>
          <DialogTitle>Sign-off roles</DialogTitle>
          <DialogDescription>
            Who releases hold points and witnesses work on this project. Add the
            signer's email so they can sign from their own login.
          </DialogDescription>
        </DialogHeader>
        <QueryState
          query={query}
          errorTitle="Couldn't load the roles"
          empty={
            <p className="text-sm text-muted-foreground">
              No roles yet. Applying a template adds the roles it names.
            </p>
          }
        >
          {(roles) => (
            <ul className="flex flex-col gap-3" data-testid="role-list">
              {roles.map((role) => (
                <RoleRow
                  key={role.id}
                  role={role}
                  projectId={projectId}
                  canManage={canManage}
                />
              ))}
            </ul>
          )}
        </QueryState>
        {canManage ? <AddRole projectId={projectId} /> : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function useRolesRefresh(projectId: number) {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({
      queryKey: ["projects", projectId, "signoff-roles"],
    })
    queryClient.invalidateQueries({ queryKey: ["itps"] })
  }
}

function RoleRow({
  role,
  projectId,
  canManage,
}: {
  role: SignoffRolePublic
  projectId: number
  canManage: boolean
}) {
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const refresh = useRolesRefresh(projectId)
  const [name, setName] = useState(role.role_name)
  const [party, setParty] = useState<Party>(role.party as Party)
  const [email, setEmail] = useState(role.signer_email ?? "")

  useEffect(() => {
    setName(role.role_name)
    setParty(role.party as Party)
    setEmail(role.signer_email ?? "")
  }, [role])

  const dirty =
    name.trim() !== role.role_name ||
    party !== role.party ||
    email.trim() !== (role.signer_email ?? "")

  const save = useMutation({
    mutationFn: () =>
      ItpsService.updateSignoffRole({
        path: { role_id: role.id },
        body: {
          role_name: name.trim(),
          party,
          signer_email: email.trim() || null,
        },
      }),
    onSuccess: () => {
      showSuccessToast("Role saved")
      refresh()
    },
    onError: (error: Error) => showErrorToast(extractErrorMessage(error)),
  })
  const remove = useMutation({
    mutationFn: () =>
      ItpsService.deleteSignoffRole({ path: { role_id: role.id } }),
    onSuccess: () => {
      showSuccessToast("Role deleted")
      refresh()
    },
    onError: (error: Error) => showErrorToast(extractErrorMessage(error)),
  })

  if (!canManage) {
    return (
      <li className="rounded-md border p-3 text-sm" data-testid="role-row">
        <p className="font-medium">{role.role_name}</p>
        <p className="text-muted-foreground">
          {PARTY_OPTIONS.find((p) => p.value === role.party)?.label} ·{" "}
          {role.signer_email ?? "signed by a project owner"} · {role.item_count}{" "}
          line{role.item_count === 1 ? "" : "s"}
        </p>
      </li>
    )
  }

  return (
    <li
      className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_8rem_1fr_auto]"
      data-testid="role-row"
    >
      <Input
        aria-label="Role name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <NativeSelect
        aria-label="Party"
        value={party}
        onChange={(e) => setParty(e.target.value as Party)}
      >
        {PARTY_OPTIONS.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </NativeSelect>
      <Input
        aria-label="Signer email"
        type="email"
        placeholder="Signer email (optional)"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        data-testid="role-email"
      />
      <div className="flex gap-1">
        <LoadingButton
          size="icon"
          variant="outline"
          aria-label={`Save ${role.role_name}`}
          disabled={!dirty || !name.trim()}
          loading={save.isPending}
          onClick={() => save.mutate()}
          data-testid="save-role"
        >
          <Save />
        </LoadingButton>
        <LoadingButton
          size="icon"
          variant="ghost"
          className="text-destructive hover:text-destructive"
          aria-label={`Delete ${role.role_name}`}
          disabled={(role.item_count ?? 0) > 0}
          title={
            (role.item_count ?? 0) > 0
              ? `${role.item_count} line(s) need this role`
              : undefined
          }
          loading={remove.isPending}
          onClick={() => remove.mutate()}
        >
          <Trash2 />
        </LoadingButton>
      </div>
      <p className="text-xs text-muted-foreground sm:col-span-4">
        Needed on {role.item_count} line{role.item_count === 1 ? "" : "s"}
      </p>
    </li>
  )
}

function AddRole({ projectId }: { projectId: number }) {
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const refresh = useRolesRefresh(projectId)
  const [name, setName] = useState("")
  const [party, setParty] = useState<Party>("client")
  const [email, setEmail] = useState("")
  const add = useMutation({
    mutationFn: () =>
      ItpsService.createSignoffRole({
        path: { project_id: projectId },
        body: {
          role_name: name.trim(),
          party,
          signer_email: email.trim() || null,
        },
      }),
    onSuccess: () => {
      showSuccessToast("Role added")
      setName("")
      setEmail("")
      refresh()
    },
    onError: (error: Error) => showErrorToast(extractErrorMessage(error)),
  })
  return (
    <form
      className="grid gap-2 rounded-md border border-dashed p-3 sm:grid-cols-[1fr_8rem_1fr_auto]"
      onSubmit={(event) => {
        event.preventDefault()
        if (name.trim()) add.mutate()
      }}
    >
      <Input
        aria-label="New role name"
        placeholder="New role, e.g. Superintendent"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <NativeSelect
        aria-label="New role party"
        value={party}
        onChange={(e) => setParty(e.target.value as Party)}
      >
        {PARTY_OPTIONS.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </NativeSelect>
      <Input
        aria-label="New role signer email"
        type="email"
        placeholder="Signer email (optional)"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <LoadingButton
        type="submit"
        size="icon"
        aria-label="Add role"
        loading={add.isPending}
        disabled={!name.trim()}
      >
        <Plus />
      </LoadingButton>
    </form>
  )
}
