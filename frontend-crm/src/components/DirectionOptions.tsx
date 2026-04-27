import { DIRECTION_LABEL, type Direction } from '../api/types';

const ORDER: Direction[] = [
  'BACHELOR',
  'MASTER',
  'LANGUAGE',
  'LANGUAGE_COLLEGE',
  'LANGUAGE_BACHELOR',
  'COLLEGE',
];

export default function DirectionOptions() {
  return (
    <>
      {ORDER.map((d) => (
        <option key={d} value={d}>
          {DIRECTION_LABEL[d]}
        </option>
      ))}
    </>
  );
}
