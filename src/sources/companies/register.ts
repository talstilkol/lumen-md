/**
 * The companies register (רשם החברות, Israeli Corporations Authority) on
 * data.gov.il (plan R12.19): a configuration of sources/registers/ckanRegister.
 * A company's number is nine digits (51-… for a private company, 52-… for a
 * public one).
 */
import { lookup, type RegisterConfig, type RegisterRecord } from "../registers/ckanRegister";

export const COMPANIES: RegisterConfig = {
  source: "companies",
  dataset: "ica_companies",
  resourceId: "f004176c-b85f-4542-8901-7b3176f9a054",
  numberField: "מספר חברה",
  nameFields: ["שם חברה", "שם באנגלית"],
  statusFields: ["סטטוס חברה", "סטטוס"],
  numberPrefixes: ["51", "52", "53", "54", "55", "56", "57", "59"],
};

export const searchCompanies = (query: string, fetchImpl: typeof fetch): Promise<RegisterRecord[]> => lookup(COMPANIES, query, fetchImpl);
