export default function TermsPage() {
  return (
    <div className="w-full min-h-[50vh] flex flex-col items-center py-24 px-6">
      <div className="max-w-3xl w-full">
        <h1 className="text-4xl font-bold tracking-tight text-obsidian mb-8">Terms of Service</h1>
        <div className="prose prose-slate max-w-none text-slate">
          <p>Last updated: {new Date().toLocaleDateString()}</p>
          <p>This is a placeholder for the Regent terms of service.</p>
        </div>
      </div>
    </div>
  );
}
