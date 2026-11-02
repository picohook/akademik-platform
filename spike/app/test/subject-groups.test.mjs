import test from 'node:test';
import assert from 'node:assert/strict';
import { subjectGroup, subjectGroupLabel, subjectGroupKeys } from '../public/subject-groups.mjs';

const group = (...subjects) => subjectGroup({ subjects });

test('free-text subjects fall into broad groups, in English and Turkish', () => {
  assert.equal(group('Machine learning'), 'ai');
  assert.equal(group('Makine öğrenmesi'), 'ai');
  assert.equal(group('Yapay Zekâ'), 'ai');
  assert.equal(group('Biostatistics'), 'statistics');
  assert.equal(group('İstatistik'), 'statistics');
  assert.equal(group('Nursing'), 'health');
  assert.equal(group('Diş hekimliği'), 'health');
  assert.equal(group('Research methods'), 'research');
  assert.equal(group('Open access'), 'openscience');
  assert.equal(group('Academic writing'), 'writing');
  assert.equal(group('Mathematics'), 'math');
  assert.equal(group('Logic'), 'logic');
  assert.equal(group('History'), 'humanities');
  assert.equal(group('Science'), 'science');
});

test('a book with no matching subject is "other"; the first matching group wins', () => {
  assert.equal(group('Demo', 'Platform testing'), 'other');
  assert.equal(subjectGroup({}), 'other');
  assert.equal(group('Statistics for machine learning'), 'ai');
});

test('labels follow the interface language and upper-case correctly in it', () => {
  assert.equal(subjectGroupLabel('health', 'tr'), 'Sağlık bilimleri');
  assert.equal(subjectGroupLabel('ai', 'en'), 'Artificial intelligence');
  assert.equal(subjectGroupLabel('ai', 'tr').toLocaleUpperCase('tr'), 'YAPAY ZEKÂ');
  assert.equal(subjectGroupLabel('statistics', 'tr').toLocaleUpperCase('tr'), 'İSTATİSTİK');
  assert.equal(subjectGroupLabel('ai', 'en').toLocaleUpperCase('en'), 'ARTIFICIAL INTELLIGENCE');
});

test('the filter lists only the groups present, in a fixed order with "other" last', () => {
  const books = [{ subjects: ['Demo'] }, { subjects: ['Nursing'] }, { subjects: ['Machine learning'] }, { subjects: ['Deep learning'] }];
  assert.deepEqual(subjectGroupKeys(books), ['ai', 'health', 'other']);
});
