import type { AuthedRequest } from '../http/types';
import type { StudentService } from '../../services/student.service';

export function makeStudentController(deps: { student: StudentService }) {
  return {
    async list(req: AuthedRequest) {
      const grade = req.query['grade'] ? parseInt(req.query['grade']!, 10) : undefined;
      const gender = req.query['gender'];
      const query = req.query['q'];
      const crossGrade = req.query['crossGrade'] === '1' || req.query['crossGrade'] === 'true';
      return deps.student.list(req.ctx, { grade, gender, query, crossGrade });
    },

    async get(req: AuthedRequest) {
      return deps.student.get(req.ctx, req.params['id']!);
    },

    async create(req: AuthedRequest) {
      return deps.student.create(req.ctx, req.body);
    },

    async update(req: AuthedRequest) {
      return deps.student.update(req.ctx, req.params['id']!, req.body);
    },


    async graduated(req: AuthedRequest) {
      return { rows: await deps.student.listGraduated(req.ctx) };
    },

    async ungraduate(req: AuthedRequest) {
      await deps.student.ungraduate(req.ctx, req.params['id']!);
      return { ok: true };
    },

    async remove(req: AuthedRequest) {
      await deps.student.remove(req.ctx, req.params['id']!);
      return { ok: true };
    },
  };
}
