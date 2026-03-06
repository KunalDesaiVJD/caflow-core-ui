const Index = () => (
  <div>
    <h1 className="text-2xl font-display font-bold text-foreground mb-2">Dashboard</h1>
    <p className="text-muted-foreground">Welcome back, Rajesh. Here's your practice overview.</p>
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
      {[
        { label: "Active Clients", value: "142" },
        { label: "Pending TDS", value: "23" },
        { label: "IT Returns Due", value: "8" },
        { label: "Revenue (MTD)", value: "₹4.2L" },
      ].map((stat) => (
        <div key={stat.label} className="bg-card rounded-lg border border-border p-5">
          <p className="text-sm text-muted-foreground">{stat.label}</p>
          <p className="text-2xl font-display font-bold text-foreground mt-1">{stat.value}</p>
        </div>
      ))}
    </div>
  </div>
);

export default Index;
