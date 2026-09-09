import {describe,it,expect} from 'vitest';
import {crossFittedCorrection} from './usageRevenue';

describe('cross-fitted component correction',()=>{
 it('corrects a consistent overprediction and leaves an exact model alone',()=>{
  expect(crossFittedCorrection([{predicted:120,actual:100},{predicted:240,actual:200}])).toBeCloseTo(5/6);
  expect(crossFittedCorrection([{predicted:100,actual:100}])).toBe(1);
 });
 it('weights by percentage error rather than store revenue and resists an extreme ratio',()=>{
  const pairs=[{predicted:100,actual:100},{predicted:100,actual:100},{predicted:100,actual:10000}];
  expect(crossFittedCorrection(pairs)).toBe(1);
  expect(crossFittedCorrection(pairs.map(p=>({predicted:p.predicted*1000,actual:p.actual*1000})))).toBe(1);
 });
 it('uses no correction for invalid or absent calibration evidence',()=>{
  expect(crossFittedCorrection([])).toBe(1);
  expect(crossFittedCorrection([{predicted:0,actual:100}])).toBe(1);
  expect(crossFittedCorrection([{predicted:100,actual:NaN}])).toBe(1);
 });
});
