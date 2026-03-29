/**
 * lib/invoiceReferenceData.ts
 *
 * Loads and parses the two Xero reference CSV files that live in /data/.
 * Exported arrays are used by the AI invoice extraction API route to give
 * the model exact item codes and account codes — no guessing.
 *
 * Data is loaded once at module initialisation (singleton, not per-request).
 * If a file cannot be read the export returns an empty array so the API
 * degrades gracefully rather than crashing.
 *
 * Server-side only — never import this in client components.
 */

import fs from 'fs'
import path from 'path'

// ─── Types ────────────────────────────────────────────────────────────────────

/** A single purchasable inventory item from Xero */
export interface InventoryItem {
  /** Exact Xero item code, e.g. "10001" */
  itemCode: string
  /** Human-readable name, e.g. "GreenPro Dishwash Det" */
  itemName: string
  /** Purchase-side description (often the same as itemName) */
  purchasesDescription: string
  /** Xero account code for purchases, e.g. "310" or "408" */
  purchasesAccount: string
  /** Xero tax rate name, e.g. "GST on Expenses" or "GST Free Expenses" */
  purchasesTaxRate: string
}

/** A single expense-type account from the Xero Chart of Accounts */
export interface ChartOfAccount {
  /** Xero account code, e.g. "310" */
  code: string
  /** Account name, e.g. "Cost of Goods Sold" */
  name: string
  /** Tax code name, e.g. "GST on Expenses" */
  taxCode: string
}

// ─── CSV parser ───────────────────────────────────────────────────────────────

/**
 * Minimal CSV parser that correctly handles quoted fields containing commas.
 * Returns an array of rows, each row being an array of field strings.
 * Strips surrounding double-quotes and trims whitespace from each field.
 */
function parseCsv(content: string): string[][] {
  const rows: string[][] = []

  // Normalise line endings then split — handles Windows \r\n files
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')

  for (const line of lines) {
    if (!line.trim()) continue

    const fields: string[] = []
    let field = ''
    let inQuotes = false

    for (let i = 0; i < line.length; i++) {
      const char = line[i]

      if (char === '"') {
        // Handle escaped double-quotes ("") inside a quoted field
        if (inQuotes && line[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = !inQuotes
        }
      } else if (char === ',' && !inQuotes) {
        fields.push(field.trim())
        field = ''
      } else {
        field += char
      }
    }
    fields.push(field.trim())
    rows.push(fields)
  }

  return rows
}

/**
 * Returns the column index for a header name.
 * Strips the leading "*" that Xero uses on required columns.
 */
function colIndex(header: string[], name: string): number {
  return header.findIndex(h => h.replace(/^\*/, '').trim() === name)
}

// ─── Loaders ──────────────────────────────────────────────────────────────────

/**
 * Reads InventoryItems-20260329.csv and returns only items where:
 * - Status = Active
 * - PurchasesAccount is not empty (i.e. the item is purchasable)
 */
function loadInventoryItems(): InventoryItem[] {
  const filePath = path.join(process.cwd(), 'data', 'InventoryItems-20260329.csv')

  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const rows = parseCsv(content)
    if (rows.length < 2) return []

    const header = rows[0]
    const iItemCode    = colIndex(header, 'ItemCode')
    const iItemName    = colIndex(header, 'ItemName')
    const iPurchDesc   = colIndex(header, 'PurchasesDescription')
    const iPurchAcct   = colIndex(header, 'PurchasesAccount')
    const iPurchTax    = colIndex(header, 'PurchasesTaxRate')
    const iStatus      = colIndex(header, 'Status')

    return rows.slice(1)
      .filter(row => {
        const status  = (row[iStatus]  || '').toLowerCase()
        const account = (row[iPurchAcct] || '').trim()
        return status === 'active' && account !== ''
      })
      .map(row => ({
        itemCode:             (row[iItemCode]  || '').trim(),
        itemName:             (row[iItemName]  || '').trim(),
        purchasesDescription: (row[iPurchDesc] || '').trim(),
        purchasesAccount:     (row[iPurchAcct] || '').trim(),
        purchasesTaxRate:     (row[iPurchTax]  || '').trim(),
      }))
      .filter(item => item.itemCode && item.itemName)

  } catch (err) {
    console.error('invoiceReferenceData: failed to load InventoryItems CSV:', err)
    return []
  }
}

/**
 * Reads ChartOfAccounts.csv and returns only accounts whose *Type is one of:
 * Expense, Direct Costs, Overhead, Purchases
 *
 * These are the only account types that appear on a supplier bill line item.
 */
function loadChartOfAccounts(): ChartOfAccount[] {
  const filePath = path.join(process.cwd(), 'data', 'ChartOfAccounts.csv')

  const EXPENSE_TYPES = new Set(['Expense', 'Direct Costs', 'Overhead', 'Purchases'])

  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const rows = parseCsv(content)
    if (rows.length < 2) return []

    const header = rows[0]
    const iCode    = colIndex(header, 'Code')
    const iName    = colIndex(header, 'Name')
    const iType    = colIndex(header, 'Type')
    const iTaxCode = colIndex(header, 'Tax Code')

    return rows.slice(1)
      .filter(row => {
        const code = (row[iCode] || '').trim()
        const type = (row[iType] || '').trim()
        return code !== '' && EXPENSE_TYPES.has(type)
      })
      .map(row => ({
        code:    (row[iCode]    || '').trim(),
        name:    (row[iName]    || '').trim(),
        taxCode: (row[iTaxCode] || '').trim(),
      }))

  } catch (err) {
    console.error('invoiceReferenceData: failed to load ChartOfAccounts CSV:', err)
    return []
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

/** All active, purchasable inventory items — loaded once at startup */
export const inventoryItems: InventoryItem[] = loadInventoryItems()

/** All expense/cost chart of account entries — loaded once at startup */
export const chartOfAccounts: ChartOfAccount[] = loadChartOfAccounts()
