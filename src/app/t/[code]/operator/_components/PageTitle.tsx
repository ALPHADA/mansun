export function PageTitle({ title, uc, children }: { title: string; uc?: string; children?: React.ReactNode }) {
  return (
    <div className="page-title">
      <h2>{title}{uc && <span className="uc">{uc}</span>}</h2>
      {children && <div className="actions">{children}</div>}
    </div>
  );
}
