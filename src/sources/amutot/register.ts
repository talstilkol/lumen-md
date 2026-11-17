/**
 * The non-profits register (רשם העמותות, Israeli Corporations Authority) on
 * data.gov.il (plan R12.19): a configuration of sources/registers/ckanRegister.
 * A non-profit's number is nine digits starting 58 (58-012345-6).
 */
import { lookup, type RegisterConfig, type RegisterRecord } from "../registers/ckanRegister";

export const AMUTOT: RegisterConfig = {
  source: "amutot",
  dataset: "moj-amutot",
  resourceId: "be5b7935-3922-45d4-9638-08871b17ec95",
  numberField: "מספר עמותה",
  nameFields: ["שם עמותה בעברית", "שם עמותה באנגלית"],
  statusFields: ["סטטוס עמותה", "סטטוס"],
  numberPrefixes: ["58"],
};

export const searchAmutot = (query: string, fetchImpl: typeof fetch): Promise<RegisterRecord[]> => lookup(AMUTOT, query, fetchImpl);
