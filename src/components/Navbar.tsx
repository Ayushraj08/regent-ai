import Link from "next/link";
import { PhoneCall } from "lucide-react";

export function Navbar() {
  return (
    <nav className="w-full border-b border-slate/20 bg-bone text-obsidian sticky top-0 z-50 shadow-sm">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2 group">
            <div className="w-8 h-8 bg-obsidian text-bone flex items-center justify-center rounded-sm group-hover:bg-regent transition-colors">
              <span className="font-bold text-lg leading-none">R</span>
            </div>
            <span className="font-bold tracking-tight text-xl">Regent</span>
          </Link>
          <div className="hidden md:flex gap-6 text-sm font-medium text-text-secondary-light">
            <Link href="/product" className="hover:text-obsidian transition-colors">Product</Link>
            <Link href="/for-hvac" className="hover:text-obsidian transition-colors">HVAC</Link>
            <Link href="/for-plumbers" className="hover:text-obsidian transition-colors">Plumbing</Link>
            <Link href="/for-electricians" className="hover:text-obsidian transition-colors">Electrical</Link>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/demo" className="text-sm font-medium text-text-secondary-light hover:text-regent transition-colors hidden sm:block">
            Try Demo
          </Link>
          <Link href="/login" className="text-sm font-medium px-4 py-2 bg-obsidian text-bone hover:bg-regent hover:text-bone transition-colors flex items-center gap-2 rounded-sm">
            <PhoneCall className="w-4 h-4" />
            <span>Connect</span>
          </Link>
        </div>
      </div>
    </nav>
  );
}
