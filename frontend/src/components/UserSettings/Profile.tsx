import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import useAuth from "@/hooks/useAuth"
import { getInitials } from "@/utils"

function Row({ label, value }: { label: string; value?: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[10rem_1fr] sm:items-baseline">
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm">
        {value || <span className="text-muted-foreground">N/A</span>}
      </dd>
    </div>
  )
}

/**
 * Read-only profile. Identity is managed by Auth0 (no local users table), so
 * name, email and password changes happen with the identity provider, not
 * here. `sub` is shown so support can match a person to their records.
 */
const Profile = () => {
  const { user } = useAuth()

  if (!user) return null

  return (
    <div className="max-w-xl" data-testid="profile">
      <div className="flex items-center gap-4 py-4">
        <Avatar className="size-14">
          {user.picture ? <AvatarImage src={user.picture} alt="" /> : null}
          <AvatarFallback className="bg-vri-gold text-vri-charcoal text-lg font-semibold">
            {getInitials(user.name || user.email || "VR")}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <h3 className="truncate text-lg font-semibold">
            {user.name || user.email}
          </h3>
          <p className="text-sm text-muted-foreground">
            Signed in with your organization account
          </p>
        </div>
      </div>

      <dl className="flex flex-col gap-3 rounded-lg border p-4">
        <Row label="Name" value={user.name} />
        <Row label="Email" value={user.email} />
        <Row label="Account ID" value={user.sub} />
      </dl>

      <p className="mt-4 text-sm text-muted-foreground">
        Your name, email and password are managed by the sign-in provider. Ask
        your administrator to make changes.
      </p>
    </div>
  )
}

export default Profile
