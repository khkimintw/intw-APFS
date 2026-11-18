// Pure list filtering shared by the company table and the XLSX export (both use the same `visible` rows).
export const ALL = '전체';

/** Distinct, non-empty intake_date values exactly as stored (no parsing or inferred dates), newest-looking last-sorted by text. */
export function intakeOptions(companies) {
  return [...new Set(companies.map(company => (company.intake_date == null ? '' : String(company.intake_date).trim())).filter(Boolean))]
    .sort((a, b) => b.localeCompare(a, 'ko', { numeric: true }));
}

export function filterCompanies(companies, f) {
  const query = String(f.search || '').trim().toLowerCase();
  const intake = f.intake ?? ALL;
  return companies.filter(company =>
    (f.theme === ALL || !f.theme || company.theme === f.theme)
    && (f.status === ALL || !f.status || company.status === f.status)
    && (intake === ALL || String(company.intake_date ?? '').trim() === intake)
    && (f.consultant === ALL || !f.consultant || (f.consultant === 'none' ? !company.assigned_consultant_id : company.assigned_consultant_id === f.consultant))
    && (!f.directOnly || company.ir_direct)
    && `${company.business_name} ${company.theme || ''} ${company.status || ''}`.toLowerCase().includes(query));
}

/** '접수 주차' only when an actual stored value mentions 주/주차; otherwise '접수일'. Values are never transformed. */
export function intakeLabel(companies) {
  return companies.some(company => String(company.intake_date ?? '').includes('주')) ? '접수 주차' : '접수일';
}
