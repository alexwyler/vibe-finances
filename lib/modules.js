import northwesternMutual from '../modules/northwesternMutual.js';
import wealthfront from '../modules/wealthfront.js';

export const MODULES = [northwesternMutual, wealthfront];

export function getModuleById(moduleId) {
  return MODULES.find((module) => module.id === moduleId);
}

export function flattenExtractors(module) {
  return module.pages.flatMap((page) => page.extractors);
}
