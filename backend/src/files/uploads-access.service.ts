import { Injectable } from '@nestjs/common';
import { FileRef } from './file-resolver.service';
import { SessionIdentity } from '../auth/session-resolver.service';
import { canAccessStudentRecord, STUDENT_RESTRICTED_DOC_TYPES } from '../common/access';
import { isPrivileged } from '../common/roles';

export type AccessDecision = 'allow' | 'deny';

/**
 * Чистая функция принятия решения: (личность, файл) → allow | deny.
 * Без Prisma и без Express — единственное место, где живут правила
 * доступа к /uploads, поэтому легко покрывается unit-тестами.
 *
 * Отказ ВСЕГДА 'deny' → 404 (не 401/403) в контроллере — та же логика
 * «не быть оракулом существования», что и в students.service.findOne()
 * Волны 0: иначе по коду ответа можно было бы угадывать существование
 * чужого файла/документа/студента.
 *
 * Матрица (см. архитектурный план Волны 1):
 *  - PROGRAM_IMAGE → allow всем, включая анонима;
 *  - неизвестный файл (ref === null, «сирота» на диске) → deny всем;
 *  - DOCUMENT/STUDENT_PHOTO анониму → deny;
 *  - FOUNDER/ADMIN → allow всё, включая soft-deleted документы
 *    (soft-delete = восстановимо, админ должен видеть содержимое перед
 *    восстановлением);
 *  - EMPLOYEE → allow только для СВОИХ студентов (canAccessStudentRecord,
 *    та же формула что в students.service.ts/applications.service.ts) и
 *    только для НЕ удалённых документов;
 *  - STUDENT → allow только для СВОИХ файлов; BANK/MEDICAL — deny всегда
 *    (коммит 0acb4b5: студент не должен скачивать эти типы, даже свои).
 */
@Injectable()
export class UploadsAccessService {
  decide(identity: SessionIdentity, ref: FileRef): AccessDecision {
    if (!ref) return 'deny';

    if (ref.kind === 'PROGRAM_IMAGE') return 'allow';

    if (identity.kind === 'anonymous') return 'deny';

    if (identity.kind === 'staff') {
      if (isPrivileged(identity.role)) return 'allow';
      if (ref.kind === 'DOCUMENT' && ref.deletedAt) return 'deny';
      return canAccessStudentRecord({ managerId: ref.managerId, chinaManagerId: ref.chinaManagerId }, identity)
        ? 'allow'
        : 'deny';
    }

    // identity.kind === 'student'
    if (ref.kind === 'DOCUMENT') {
      if (ref.deletedAt) return 'deny';
      if (ref.studentId !== identity.id) return 'deny';
      if (STUDENT_RESTRICTED_DOC_TYPES.has(ref.docType)) return 'deny';
      return 'allow';
    }
    if (ref.kind === 'STUDENT_PHOTO') {
      return ref.studentId === identity.id ? 'allow' : 'deny';
    }
    return 'deny';
  }
}
