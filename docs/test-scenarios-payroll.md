# Payroll Module — Test Scenarios

Manual test scenarios for the payroll module, plus notes on the automated
tax-engine simulation. All amounts in GHS.

Statutory parameters (from Settings, default values):

| Setting | Default | Meaning |
|---------|---------|---------|
| `pension_employee_rate` | 5.5 | Employee SSNIT % of basic |
| `pension_employer_rate` | 13 | Employer SSNIT % of basic |
| `ssnit_monthly_cap` | 61000 | Monthly insurable-earnings ceiling |
| `paye_bands` | `490:0,110:5,130:10,3166.67:17.5,16000:25,30520:30,0:35` | Monthly PAYE bands `width:rate` (last width 0 = remainder) |

Accounts used:

| Code | Account |
|------|---------|
| 6100 | Salary & Wages (Expense) |
| 6110 | Employer Pension Contribution (Expense) |
| 2220 | PAYE Payable (Liability) |
| 2230 | Pension Payable (Liability) |
| 2240 | Net Salary Payable (Liability) |
| 2300 | Accrued Expenses (Liability) — other deductions |
| 1210 | Main Bank Account / 1100 Cash on Hand |

---

## Automated simulation

`tests/payroll_integrity_sim.js` is a self-contained Node simulation of the
tax engine and the payroll journal. Run:

```
node tests/payroll_integrity_sim.js
```

Expected: every line prefixed with `✓`, ending in
`=== ALL PAYROLL SCENARIOS COMPLETE ===`. It covers SSNIT (with the cap),
progressive PAYE bands, the full payslip, and that the payroll journal
balances (debits = credits).

---

## Manual scenario 1 — Create a salary structure

1. Payroll → Salary Structures → **New Structure**.
2. Name "Officer Grade 1", Basic 3,000, Transport 300, Housing 200.
3. Save.

**Verify**: it appears in the list with the correct amounts.

---

## Manual scenario 2 — Create an employee from a structure

1. Payroll → Employees → **New Employee**.
2. Enter name; select Salary Structure "Officer Grade 1".
3. The basic and allowance fields auto-fill (3,000 / 300 / 200).
4. Leave SSNIT and PAYE applicable both ticked. Add a bank name and SSNIT number.
5. Save.

**Verify**: the employee detail shows Basic 3,000 and Allowances 500.

---

## Manual scenario 3 — Preview a payslip

On the employee detail, click **Preview Payslip**.

**Expected calculation** (basic 3,000, allowances 500):
- Gross = 3,500
- Employee SSNIT = 5.5% × 3,000 = **165.00**
- Chargeable income = 3,500 − 165 = 3,335
- PAYE on 3,335:
  - 490 @ 0% = 0
  - 110 @ 5% = 5.50
  - 130 @ 10% = 13.00
  - remaining 2,605 @ 17.5% = 455.88
  - **PAYE = 474.38**
- Total deductions = 165 + 474.38 = 639.38
- **Net pay = 2,860.62**
- Employer SSNIT = 13% × 3,000 = 390.00
- Total employer cost = 3,500 + 390 = 3,890.00

The payslip card shows each PAYE band line.

---

## Manual scenario 4 — SSNIT cap

1. Create an employee with basic salary 70,000.
2. Preview the payslip.

**Expected**: SSNIT base is capped at 61,000, so:
- Employee SSNIT = 5.5% × 61,000 = **3,355.00** (not 3,850)
- Employer SSNIT = 13% × 61,000 = **7,930.00**

---

## Manual scenario 5 — Non-statutory employee

1. Create an employee and untick **SSNIT applicable** and **PAYE applicable**
   (e.g. a contractor invoiced gross).
2. Preview.

**Expected**: SSNIT = 0, PAYE = 0, Net pay = Gross.

---

## Manual scenario 6 — Preview a payroll run

1. Payroll → Payroll Runs.
2. Pick the current period and click **Preview**.

**Expected**: a table of every active employee with gross, SSNIT, PAYE, and
net, plus a totals row and an employer-cost footer. Nothing is saved yet
(the history table is unchanged).

---

## Manual scenario 7 — Process a payroll run

1. With the period selected, click **Process** and confirm.

**Expected**:
- A toast reports the run processed with the journal number and total net.
- The run detail opens, listing one payslip per employee.
- Accounting → Journal Entries shows a "Payroll yyyy-MM" entry:
  ```
  Dr Salary & Wages (6100)               total gross
  Dr Employer Pension Contribution (6110) total employer SSNIT
     Cr PAYE Payable (2220)               total PAYE
     Cr Pension Payable (2230)            employee + employer SSNIT
     Cr Net Salary Payable (2240)         total net
  ```
- Accounting → Trial Balance still shows **Balanced**.

**Duplicate guard**: processing the same period again is rejected.

---

## Manual scenario 8 — Pay net salaries

1. On the processed run detail, click **Pay Net Salaries**.
2. Choose "Bank Transfer" and confirm.

**Expected journal**:
```
Dr Net Salary Payable (2240)   total net
   Cr Main Bank Account (1210)        total net
```
The run status becomes **Paid**. PAYE Payable and Pension Payable remain on
the balance sheet until remitted to GRA / SSNIT.

---

## Manual scenario 9 — Books stay balanced

1. Accounting → Trial Balance → **Validate Books** after processing and paying.

**Expected**: all three checks pass (trial balance, balance sheet, per-entry).
Account 6100 reflects total gross as an expense; 2220 and 2230 hold the
statutory liabilities; 2240 is back to zero once salaries are paid.
