import bankOfAmerica from '../modules/bankOfAmerica.js';
import chase from '../modules/chase.js';
import northwesternMutual from '../modules/northwesternMutual.js';
import schwab from '../modules/schwab.js';
import wealthfront from '../modules/wealthfront.js';

export const MODULES = [northwesternMutual, schwab, wealthfront, bankOfAmerica, chase];

export function getModuleById(moduleId) {
  return MODULES.find((module) => module.id === moduleId);
}

export function flattenExtractors(module) {
  return module.pages.flatMap((page) => page.extractors);
}
