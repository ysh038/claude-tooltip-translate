// 에디션에 포함된 provider 목록과 선택 로직
// 'edition:providers'는 빌드 시 editions/<name>.json의 providers 목록으로 생성되는 가상 모듈.
// → store 빌드에는 claude-cli 코드가 아예 들어가지 않는다.
import { PROVIDERS } from 'edition:providers';
import { assertProvider } from './provider.js';

PROVIDERS.forEach(assertProvider);

export { PROVIDERS };

export const getProvider = (id) => PROVIDERS.find((p) => p.id === id) || null;

/** source: 'hover' | 'selection' — 저장된 엔진이 이 에디션에 없으면 첫 번째 provider */
export function engineFor(source, s) {
  const id = source === 'hover' ? s.hoverEngine : s.selectionEngine;
  return getProvider(id) || PROVIDERS[0];
}
