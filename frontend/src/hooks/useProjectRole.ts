import { useQuery } from "@tanstack/react-query"

import type { MemberPublic } from "@/client"
import useAuth, { type SessionUser } from "@/hooks/useAuth"
import { membersQuery } from "@/lib/queries"

export type ProjectRole = "owner" | "inspector" | "viewer"

/**
 * The caller's membership row, matched the way the API matches it: by
 * `user_sub` when the row has one, otherwise by email (case-insensitive).
 */
export function findOwnMembership(
  members: MemberPublic[] | undefined,
  user: SessionUser | null,
): MemberPublic | undefined {
  if (!members || !user) return undefined
  const bySub = members.find(
    (member) => member.user_sub && member.user_sub === user.sub,
  )
  if (bySub) return bySub
  const email = user.email?.toLowerCase()
  if (!email) return undefined
  return members.find(
    (member) => (member.user_email ?? member.email)?.toLowerCase() === email,
  )
}

/**
 * What the signed-in person may do in a project, from `docs/API_PORT.md`'s
 * role policy: viewers read, inspectors write inspections/findings/photos,
 * owners also edit the project and manage members.
 *
 * The API is the authority (it answers 403); this only decides which buttons
 * to show. While the members list is loading, or if it cannot be read, the
 * write actions stay visible so a slow network never hides the "New
 * inspection" button from someone entitled to it — a 403 is explained by
 * the mutation's error toast instead.
 */
export function useProjectRole(projectId: number | undefined) {
  const { user } = useAuth()
  const query = useQuery({
    ...membersQuery(projectId ?? 0),
    enabled: projectId !== undefined,
    staleTime: 60 * 1000,
  })
  const membership = findOwnMembership(query.data, user)
  const role = (membership?.role as ProjectRole | undefined) ?? undefined
  const known = query.isSuccess && membership !== undefined

  return {
    role,
    /** `true` once the role has been read from the API. */
    known,
    canWrite: !known || role === "inspector" || role === "owner",
    canManage: !known || role === "owner",
    members: query.data,
  }
}
