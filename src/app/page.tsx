import Link from "next/link";
import { Phone, ArrowRight, CheckCircle2, PhoneMissed, PhoneForwarded, MessageSquareText, ShieldAlert, Zap, Droplet, Thermometer } from "lucide-react";

export default function Home() {
  return (
    <div className="flex flex-col items-center w-full">
      {/* HERO SECTION */}
      <section className="w-full bg-obsidian text-text-primary-dark py-24 px-6 overflow-hidden relative">
        <div className="max-w-7xl mx-auto flex flex-col lg:flex-row items-center gap-16">
          <div className="flex-1 space-y-8 z-10">
            <h1 className="text-5xl md:text-6xl font-extrabold tracking-tight leading-[1.1]">
              Your phone should never lose a job.
            </h1>
            <p className="text-lg md:text-xl text-text-secondary-dark max-w-2xl leading-relaxed">
              Regent answers missed and after-hours calls for HVAC, plumbing and electrical companies, captures the job details, and sends the lead directly to your team.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 pt-4">
              <Link href="/demo" className="px-8 py-4 bg-regent text-text-primary-dark hover:bg-regent/90 transition-colors rounded-sm font-semibold text-lg flex items-center justify-center gap-2 group">
                <Phone className="w-5 h-5 group-hover:scale-110 transition-transform" />
                Hear Regent Answer a Call
              </Link>
              <Link href="#how-it-works" className="px-8 py-4 bg-obsidian border-2 border-bone/20 hover:bg-bone/10 transition-colors rounded-sm font-semibold text-lg flex items-center justify-center text-text-primary-dark">
                See How It Works
              </Link>
            </div>
          </div>
          
          <div className="flex-1 w-full max-w-lg z-10">
            {/* OPERATIONAL VISUALIZATION */}
            <div className="bg-obsidian border border-slate/30 p-6 rounded-lg shadow-2xl space-y-4 font-mono text-sm">
              <div className="flex items-center gap-4 text-text-secondary-dark">
                <div className="h-px bg-slate/30 flex-1"></div>
                <span>SYSTEM ACTIVE</span>
                <div className="h-px bg-slate/30 flex-1"></div>
              </div>
              
              <div className="flex flex-col items-center gap-2 py-4">
                <div className="w-full bg-bone/5 border border-slate/30 rounded p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <PhoneMissed className="w-5 h-5 text-emergency" />
                    <span className="font-semibold text-text-primary-dark">INCOMING CALL</span>
                  </div>
                  <span className="text-xs text-text-secondary-dark">MISSED</span>
                </div>
                
                <div className="h-6 w-px bg-slate/50"></div>
                
                <div className="w-full bg-regent/20 border border-regent/50 rounded p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="relative flex h-3 w-3">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-electric opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-electric"></span>
                    </div>
                    <span className="font-semibold text-text-primary-dark">REGENT</span>
                  </div>
                  <span className="text-xs text-electric">● LIVE</span>
                </div>
                
                <div className="h-6 w-px bg-slate/50"></div>
                
                <div className="w-full bg-bone/5 border border-slate/30 rounded p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="w-5 h-5 text-regent" />
                    <span className="font-semibold text-text-primary-dark">QUALIFIED LEAD</span>
                  </div>
                  <span className="text-xs text-text-secondary-dark">CAPTURED</span>
                </div>
                
                <div className="h-6 w-px bg-slate/50"></div>
                
                <div className="w-full bg-bone text-obsidian border border-bone rounded p-4 flex items-center justify-between shadow-lg">
                  <div className="flex items-center gap-3">
                    <PhoneForwarded className="w-5 h-5" />
                    <span className="font-bold">OWNER ALERT</span>
                  </div>
                  <span className="text-xs font-semibold bg-obsidian text-text-primary-dark px-2 py-1 rounded-sm">SMS SENT</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* PROBLEM SECTION */}
      <section className="w-full py-24 px-6 bg-bone">
        <div className="max-w-7xl mx-auto">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-obsidian mb-4">
              Your technicians can't answer every call. Regent can.
            </h2>
            <p className="text-lg text-text-secondary-light">
              Every missed call is a potential lost job. Stop sending paying customers to voicemail.
            </p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="bg-white border border-slate/20 p-8 rounded shadow-sm hover:shadow-md transition-shadow">
              <h3 className="font-bold text-lg mb-2 text-obsidian">Technician is on a job.</h3>
              <p className="text-text-secondary-light text-sm mb-6">Customer calls &rarr; nobody answers &rarr; voicemail &rarr; lost opportunity.</p>
              <div className="mt-auto pt-6 border-t border-slate/10">
                <p className="font-semibold text-regent flex items-center gap-2">
                  <ArrowRight className="w-4 h-4" /> Regent answers.
                </p>
              </div>
            </div>
            <div className="bg-white border border-slate/20 p-8 rounded shadow-sm hover:shadow-md transition-shadow">
              <h3 className="font-bold text-lg mb-2 text-obsidian">Office is already busy.</h3>
              <p className="text-text-secondary-light text-sm mb-6">Customer calls &rarr; placed on hold &rarr; hangs up.</p>
              <div className="mt-auto pt-6 border-t border-slate/10">
                <p className="font-semibold text-regent flex items-center gap-2">
                  <ArrowRight className="w-4 h-4" /> Regent captures.
                </p>
              </div>
            </div>
            <div className="bg-white border border-slate/20 p-8 rounded shadow-sm hover:shadow-md transition-shadow">
              <h3 className="font-bold text-lg mb-2 text-obsidian">It's 8:47 PM.</h3>
              <p className="text-text-secondary-light text-sm mb-6">Customer calls &rarr; voicemail &rarr; competitor answers instead.</p>
              <div className="mt-auto pt-6 border-t border-slate/10">
                <p className="font-semibold text-regent flex items-center gap-2">
                  <ArrowRight className="w-4 h-4" /> Regent alerts.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* PRODUCT SECTION (How it works) */}
      <section id="how-it-works" className="w-full py-24 px-6 bg-obsidian text-text-primary-dark">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-center mb-16 text-text-primary-dark">
            SIGNAL &rarr; CAPTURE &rarr; ACTION
          </h2>
          <div className="flex flex-col md:flex-row justify-between items-start relative">
            <div className="hidden md:block absolute top-12 left-0 w-full h-px bg-slate/30 z-0"></div>
            
            <div className="flex flex-col items-center text-center relative z-10 mb-8 md:mb-0 bg-obsidian px-4 flex-1">
              <div className="w-24 h-24 rounded-full border-4 border-slate/30 flex items-center justify-center mb-6 bg-obsidian">
                <PhoneMissed className="w-10 h-10 text-text-secondary-dark" />
              </div>
              <h4 className="font-bold text-xl mb-2 text-text-primary-dark">1. Missed Call</h4>
              <p className="text-text-secondary-dark text-sm">Your existing phone rings. If nobody answers, it routes to Regent.</p>
            </div>

            <div className="flex flex-col items-center text-center relative z-10 mb-8 md:mb-0 bg-obsidian px-4 flex-1">
              <div className="w-24 h-24 rounded-full border-4 border-regent flex items-center justify-center mb-6 bg-regent/10">
                <MessageSquareText className="w-10 h-10 text-electric" />
              </div>
              <h4 className="font-bold text-xl mb-2 text-text-primary-dark">2. Qualify</h4>
              <p className="text-text-secondary-dark text-sm">Regent identifies the problem and urgency based on your rules.</p>
            </div>

            <div className="flex flex-col items-center text-center relative z-10 mb-8 md:mb-0 bg-obsidian px-4 flex-1">
              <div className="w-24 h-24 rounded-full border-4 border-slate/30 flex items-center justify-center mb-6 bg-obsidian">
                <CheckCircle2 className="w-10 h-10 text-text-primary-dark" />
              </div>
              <h4 className="font-bold text-xl mb-2 text-text-primary-dark">3. Capture</h4>
              <p className="text-text-secondary-dark text-sm">Collects the customer's name, phone, and service address safely.</p>
            </div>

            <div className="flex flex-col items-center text-center relative z-10 bg-obsidian px-4 flex-1">
              <div className="w-24 h-24 rounded-full border-4 border-slate/30 flex items-center justify-center mb-6 bg-obsidian">
                <ShieldAlert className="w-10 h-10 text-text-primary-dark" />
              </div>
              <h4 className="font-bold text-xl mb-2 text-text-primary-dark">4. Alert</h4>
              <p className="text-text-secondary-dark text-sm">Immediately texts your team the structured lead details.</p>
            </div>
          </div>
        </div>
      </section>

      {/* TRADE SECTION */}
      <section className="w-full py-24 px-6 bg-bone border-b border-slate/10">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-obsidian mb-4">
              Configured for your trade.
            </h2>
            <p className="text-lg text-text-secondary-light max-w-2xl mx-auto">
              Regent asks the right questions for your specific services.
            </p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="p-8 border-2 border-slate/10 rounded-lg hover:border-regent/50 transition-colors bg-white">
              <Thermometer className="w-12 h-12 text-obsidian mb-6" />
              <h3 className="text-2xl font-bold mb-4 text-obsidian">HVAC</h3>
              <ul className="space-y-3 text-text-secondary-light">
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-regent" /> AC Repair & Replacement</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-regent" /> Heating & Furnaces</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-regent" /> Routine Maintenance</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emergency" /> Gas leaks & Safety escalations</li>
              </ul>
            </div>
            
            <div className="p-8 border-2 border-slate/10 rounded-lg hover:border-regent/50 transition-colors bg-white">
              <Droplet className="w-12 h-12 text-obsidian mb-6" />
              <h3 className="text-2xl font-bold mb-4 text-obsidian">Plumbing</h3>
              <ul className="space-y-3 text-text-secondary-light">
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-regent" /> Leaks & Pipe Repairs</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-regent" /> Clogged Drains & Sewers</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-regent" /> Water Heaters</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emergency" /> Active flooding escalations</li>
              </ul>
            </div>
            
            <div className="p-8 border-2 border-slate/10 rounded-lg hover:border-regent/50 transition-colors bg-white">
              <Zap className="w-12 h-12 text-obsidian mb-6" />
              <h3 className="text-2xl font-bold mb-4 text-obsidian">Electrical</h3>
              <ul className="space-y-3 text-text-secondary-light">
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-regent" /> Breakers & Panels</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-regent" /> Outages & Wiring</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-regent" /> EV Charger Inquiries</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emergency" /> Smoke/Fire escalations</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* LEAD EXAMPLE SECTION */}
      <section className="w-full py-24 px-6 bg-[#EBE8E0]">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center gap-16">
          <div className="flex-1 space-y-6">
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-obsidian">
              Every missed call becomes a structured record.
            </h2>
            <p className="text-lg text-text-secondary-light">
              Regent doesn't just record a voicemail. It creates an organized, actionable service lead so your dispatcher can prioritize follow-ups immediately.
            </p>
            <ul className="space-y-4 pt-4">
              <li className="flex items-start gap-3">
                <div className="mt-1 w-6 h-6 rounded-full bg-regent/10 flex items-center justify-center flex-shrink-0">
                  <span className="text-regent font-bold text-sm">1</span>
                </div>
                <p className="text-obsidian font-medium">Clear identification of customer and contact info.</p>
              </li>
              <li className="flex items-start gap-3">
                <div className="mt-1 w-6 h-6 rounded-full bg-regent/10 flex items-center justify-center flex-shrink-0">
                  <span className="text-regent font-bold text-sm">2</span>
                </div>
                <p className="text-obsidian font-medium">Categorization of the specific trade and service required.</p>
              </li>
              <li className="flex items-start gap-3">
                <div className="mt-1 w-6 h-6 rounded-full bg-regent/10 flex items-center justify-center flex-shrink-0">
                  <span className="text-regent font-bold text-sm">3</span>
                </div>
                <p className="text-obsidian font-medium">Automatic urgency flagging based on your emergency rules.</p>
              </li>
            </ul>
          </div>
          
          <div className="flex-1 w-full max-w-md">
            {/* MOCK LEAD CARD */}
            <div className="bg-white border border-slate/20 rounded-lg shadow-xl overflow-hidden">
              <div className="bg-obsidian text-text-primary-dark p-4 border-b border-slate/20 flex justify-between items-center">
                <h4 className="font-bold">NEW SERVICE LEAD</h4>
                <span className="text-xs bg-emergency text-white px-2 py-1 rounded font-bold">HIGH</span>
              </div>
              <div className="p-6 space-y-6">
                <div>
                  <h3 className="text-2xl font-bold text-obsidian">Sarah Johnson</h3>
                  <p className="text-text-secondary-light font-medium">HVAC &middot; AC Repair</p>
                </div>
                
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="block text-text-muted mb-1 text-xs uppercase tracking-wider font-semibold">Phone</span>
                    <span className="font-medium text-obsidian">(214) 555-0192</span>
                  </div>
                  <div>
                    <span className="block text-text-muted mb-1 text-xs uppercase tracking-wider font-semibold">Captured</span>
                    <span className="font-medium text-obsidian">Today, 8:47 PM</span>
                  </div>
                </div>
                
                <div>
                  <span className="block text-text-muted mb-1 text-xs uppercase tracking-wider font-semibold">Address</span>
                  <span className="font-medium text-obsidian">1423 Oak Street</span>
                </div>
                
                <div className="bg-slate/5 p-4 rounded border border-slate/10">
                  <span className="block text-text-muted mb-2 text-xs uppercase tracking-wider font-semibold">Problem</span>
                  <p className="font-medium text-obsidian">AC stopped cooling completely and it is getting very hot inside the house.</p>
                </div>
                
                <button className="w-full py-3 bg-regent text-text-primary-dark rounded font-bold hover:bg-regent/90 transition-colors">
                  CALLBACK REQUIRED
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" className="w-full py-24 px-6 bg-bone">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-obsidian mb-4">
            Missed-call recovery for home-service companies.
          </h2>
          <p className="text-lg text-text-secondary-light mb-12">
            Simple, predictable pricing. No long-term contracts.
          </p>
          
          <div className="bg-white border-2 border-slate/20 rounded-xl shadow-sm p-8 md:p-12 max-w-xl mx-auto text-left">
            <div className="flex items-end gap-2 mb-8 border-b border-slate/10 pb-8">
              <span className="text-5xl font-extrabold text-obsidian">$99</span>
              <span className="text-text-secondary-light font-medium text-lg mb-1">/ month</span>
            </div>
            
            <ul className="space-y-4 mb-8">
              <li className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-regent flex-shrink-0" />
                <span className="text-obsidian font-medium">Overflow call answering</span>
              </li>
              <li className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-regent flex-shrink-0" />
                <span className="text-obsidian font-medium">After-hours answering</span>
              </li>
              <li className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-regent flex-shrink-0" />
                <span className="text-obsidian font-medium">Lead capture & service-specific qualification</span>
              </li>
              <li className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-regent flex-shrink-0" />
                <span className="text-obsidian font-medium">Emergency detection & human fallback</span>
              </li>
              <li className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-regent flex-shrink-0" />
                <span className="text-obsidian font-medium">Owner SMS alerts & customer confirmations</span>
              </li>
            </ul>
            
            <div className="space-y-4">
              <Link href="/login" className="block w-full text-center py-4 bg-obsidian text-text-primary-dark font-bold rounded hover:bg-obsidian/90 transition-colors">
                Start 14-day pilot
              </Link>
              <p className="text-center text-sm text-text-secondary-light">No setup fee &middot; Cancel anytime</p>
            </div>
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="w-full py-24 px-6 bg-regent text-text-primary-dark text-center">
        <div className="max-w-3xl mx-auto space-y-8">
          <h2 className="text-4xl md:text-5xl font-extrabold tracking-tight">
            Put Regent on your missed calls.
          </h2>
          <p className="text-xl text-text-secondary-dark">
            Your technicians keep working. Regent answers the phone.
          </p>
          <div className="pt-4">
            <Link href="/login" className="inline-block px-10 py-5 bg-bone text-obsidian hover:bg-white transition-colors rounded-sm font-bold text-lg shadow-lg">
              Start catching missed calls
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
