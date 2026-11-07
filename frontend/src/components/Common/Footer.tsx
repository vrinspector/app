export function Footer() {
  const currentYear = new Date().getFullYear()

  return (
    <footer className="border-t py-4 px-6">
      <div className="flex flex-col items-center justify-between gap-2 sm:flex-row">
        <p className="text-muted-foreground text-sm">
          © {currentYear} Field Inspect LLC — VR Inspector
        </p>
        <p className="text-vri-copper text-sm italic tracking-wide">
          Inspect. Document. Verify.
        </p>
      </div>
    </footer>
  )
}
