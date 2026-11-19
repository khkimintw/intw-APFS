// Pure list filtering shared by the company table and the XLSX export (both use the same `visible` rows).
export const ALL = '전체';

/** Distinct, non-empty intake_date values exactly as stored (no parsing or inferred dates), newest-looking last-sorted by text. */
export function intakeOptions(companies) {
  return [...new Set(companies.map(company => (company.intake_date == null ? '' : String(company.intake_date).trim())).filter(Boolean))]
    .sort((a, b) => b.localeCompare(a, 'ko', { numeric: true }));
}

export function filterCompanies(companies, f) {
  const query = String(f.search || '').trim().toLowerCase();
  const digits = query.replace(/\D/g, '');
  const intake = f.intake ?? ALL;
  const category = f.directOnly ? 'ir' : (f.category ?? ALL);
  const abandoned = company => /포기/.test(String(company.status || ''));
  const reapplicant = company => /재도전|^(o|y|true|1|예)$/i.test(String(company.reapplicant || ''));
  const categoryMatch = company => category === ALL || (category === 'ir' && !!company.ir_direct) || (category === 'consult' && !company.ir_direct) || (category === 'exclude_abandoned' && !abandoned(company)) || (category === 'abandoned' && abandoned(company)) || (category === 'reapplicant' && reapplicant(company));
  return companies.filter(company =>
    (f.theme === ALL || !f.theme || company.theme === f.theme)
    && (f.status === ALL || !f.status || company.status === f.status)
    && (intake === ALL || String(company.intake_date ?? '').trim() === intake)
    && (f.consultant === ALL || !f.consultant || (f.consultant === 'none' ? !company.assigned_consultant_id : company.assigned_consultant_id === f.consultant))
    && categoryMatch(company)
    && (!query || String(company.business_name || '').toLowerCase().includes(query)
      || (digits.length >= 3 && String(company.business_registration_number || '').replace(/\D/g, '').includes(digits))));
}

/** '접수 주차' only when an actual stored value mentions 주/주차; otherwise '접수일'. Values are never transformed. */
export function intakeLabel(companies) {
  return companies.some(company => String(company.intake_date ?? '').includes('주')) ? '접수 주차' : '접수일';
}
