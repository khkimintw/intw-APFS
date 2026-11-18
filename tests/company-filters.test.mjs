import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterCompanies, intakeLabel, intakeOptions, ALL } from '../modules/companyFilters.js';
const rows = [
  { id: 1, business_name: '가상 A', theme: 't1', status: '진행', intake_date: '2026-03-02', program_year: 2026, assigned_consultant_id: 'c1', ir_direct: true },
  { id: 2, business_name: '가상 B', theme: 't1', status: '대기', intake_date: '2026-03-09', program_year: 2026, assigned_consultant_id: null },
  { id: 3, business_name: '가상 C', theme: 't2', status: '진행', intake_date: ' 2026-03-02 ', program_year: 2025, assigned_consultant_id: 'c1' },
  { id: 4, business_name: '가상 D', theme: 't2', status: '진행', intake_date: '', program_year: 2026 },
  { id: 5, business_name: '가상 E', theme: 't2', status: '진행', intake_date: null, program_year: 2026 },
];
const base = { search: '', theme: ALL, status: ALL, consultant: ALL, intake: ALL, directOnly: false };
test('intake options are distinct, trimmed, non-empty stored values only', () => {
  assert.deepEqual(intakeOptions(rows), ['2026-03-09', '2026-03-02']);
});
test('intake filter matches exact stored value (trim-insensitive), not program_year', () => {
  assert.deepEqual(filterCompanies(rows, { ...base, intake: '2026-03-02' }).map(r => r.id), [1, 3]);
  assert.deepEqual(filterCompanies(rows, { ...base, intake: '2026-03' }).map(r => r.id), []);
});
test('intake combines with other filters and IR-only', () => {
  assert.deepEqual(filterCompanies(rows, { ...base, intake: '2026-03-02', directOnly: true }).map(r => r.id), [1]);
  assert.deepEqual(filterCompanies(rows, { ...base, intake: '2026-03-02', status: '진행', consultant: 'c1', theme: 't2' }).map(r => r.id), [3]);
  assert.deepEqual(filterCompanies(rows, { ...base, consultant: 'none' }).map(r => r.id), [2, 4, 5]);
});
test('default filters keep everything; search is case-insensitive', () => {
  assert.equal(filterCompanies(rows, base).length, 5);
  assert.deepEqual(filterCompanies(rows, { ...base, search: ' 가상 b ' }).map(r => r.id), [2]);
});
test('label is 접수 주차 only when a stored value contains 주; values stay untouched', () => {
  assert.equal(intakeLabel(rows), '접수일');
  const weekly = [{ intake_date: '3월 2주차' }, { intake_date: '' }];
  assert.equal(intakeLabel(weekly), '접수 주차');
  assert.equal(intakeLabel([{ intake_date: '2주' }]), '접수 주차');
  assert.deepEqual(intakeOptions(weekly), ['3월 2주차']);
  assert.equal(intakeLabel([]), '접수일');
});
