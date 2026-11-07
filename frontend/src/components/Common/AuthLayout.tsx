import { Appearance } from "@/components/Common/Appearance"
import { Logo } from "@/components/Common/Logo"
import { Footer } from "./Footer"

interface AuthLayoutProps {
  children: React.ReactNode
}

export function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      <div className="relative hidden border-r-2 border-vri-gold bg-linear-to-br from-vri-green to-vri-green-dk lg:flex lg:flex-col lg:items-center lg:justify-center lg:gap-3">
        <Logo variant="full" className="text-5xl" asLink={false} />
        <p className="text-vri-copper text-lg italic tracking-wide">
          Inspect. Document. Verify.
        </p>
      </div>
      <div className="flex flex-col gap-4 p-6 md:p-10">
        <div className="flex items-center justify-between">
          <Logo
            variant="full"
            tone="light"
            className="text-xl lg:invisible"
            asLink={false}
          />
          <Appearance />
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-xs">{children}</div>
        </div>
        <Footer />
      </div>
    </div>
  )
}
