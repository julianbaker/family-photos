import { ageOnPartial, endOfPeriod, isPartialDate } from 'src/family/partial-date.js';

describe(isPartialDate.name, () => {
  it('accepts a year, a month or a real day', () => {
    for (const value of ['1938', '1938-03', '1938-03-14', '2024-02-29']) {
      expect(isPartialDate(value)).toBe(true);
    }
  });

  it('refuses things that are not dates', () => {
    for (const value of ['38', '1938-13', '1938-02-30', '2023-02-29', '1938-3', 'March 1938', '1938-03-14T00:00']) {
      expect(isPartialDate(value)).toBe(false);
    }
  });
});

describe(endOfPeriod.name, () => {
  it('is the last day the date could mean', () => {
    expect(endOfPeriod('1951')).toBe('1951-12-31');
    expect(endOfPeriod('1952-02')).toBe('1952-02-29');
    expect(endOfPeriod('1951-03-14')).toBe('1951-03-14');
  });
});

describe(ageOnPartial.name, () => {
  it('knows the age from a full date', () => {
    expect(ageOnPartial('1938-03-14', '1968-03-13')).toBe(29);
    expect(ageOnPartial('1938-03-14', '1968-03-14')).toBe(30);
  });

  it('gives an age from a month or year only when it cannot be either of two numbers', () => {
    expect(ageOnPartial('1938-03', '1968-05-01')).toBe(30);
    expect(ageOnPartial('1938-03', '1968-03-15')).toBeNull();
    expect(ageOnPartial('1938', '1968-12-31')).toBe(30);
    expect(ageOnPartial('1938', '1968-06-01')).toBeNull();
  });

  it('has no age before someone was born', () => {
    expect(ageOnPartial('1938-03-14', '1930-01-01')).toBeNull();
  });
});
