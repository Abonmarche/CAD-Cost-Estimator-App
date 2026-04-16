import type { CostEstimatorApi } from './index';

declare global {
  interface Window {
    costEstimator: CostEstimatorApi;
  }
}

export {};
