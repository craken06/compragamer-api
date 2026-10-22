import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { AdminKeyGuard } from '../common/admin-key.guard';
import { CoursesAdminService } from './courses-admin.service';

/* Administración de cursos: todo bajo /admin y con la sesión del admin. */
@Controller('admin')
@UseGuards(AdminKeyGuard)
export class CoursesAdminController {
  constructor(private readonly admin: CoursesAdminService) {}

  @Get('courses-status')
  status() {
    return this.admin.status();
  }

  // ---------- cursos
  @Get('courses')
  list() {
    return this.admin.list();
  }

  @Post('courses')
  create(@Body() body: any) {
    return this.admin.create(body ?? {});
  }

  @Patch('courses/order')
  reorderCourses(@Body() body: any) {
    return this.admin.reorderCourses(body?.ids);
  }

  @Get('courses/:id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.admin.get(id);
  }

  @Put('courses/:id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.admin.update(id, body ?? {});
  }

  @Delete('courses/:id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.admin.remove(id);
  }

  // ---------- módulos
  @Post('courses/:id/modules')
  createModule(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.admin.createModule(id, body ?? {});
  }

  @Patch('courses/:id/modules/order')
  reorderModules(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.admin.reorderModules(id, body?.ids);
  }

  @Put('modules/:id')
  updateModule(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.admin.updateModule(id, body ?? {});
  }

  @Delete('modules/:id')
  removeModule(@Param('id', ParseIntPipe) id: number) {
    return this.admin.removeModule(id);
  }

  // ---------- lecciones
  @Post('modules/:id/lessons')
  createLesson(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.admin.createLesson(id, body ?? {});
  }

  @Patch('modules/:id/lessons/order')
  reorderLessons(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.admin.reorderLessons(id, body?.ids);
  }

  @Put('lessons/:id')
  updateLesson(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.admin.updateLesson(id, body ?? {});
  }

  @Delete('lessons/:id')
  removeLesson(@Param('id', ParseIntPipe) id: number) {
    return this.admin.removeLesson(id);
  }

  @Post('lessons/:id/video')
  startVideo(@Param('id', ParseIntPipe) id: number) {
    return this.admin.startVideoUpload(id);
  }

  @Get('lessons/:id/video')
  videoStatus(@Param('id', ParseIntPipe) id: number) {
    return this.admin.videoStatus(id);
  }

  // ---------- recursos
  @Post('lessons/:id/resources')
  addResource(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.admin.addResource(id, body ?? {});
  }

  @Patch('lessons/:id/resources/order')
  reorderResources(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.admin.reorderResources(id, body?.ids);
  }

  @Put('resources/:id')
  updateResource(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.admin.updateResource(id, body ?? {});
  }

  @Delete('resources/:id')
  removeResource(@Param('id', ParseIntPipe) id: number) {
    return this.admin.removeResource(id);
  }

  @Get('resources/:id/download')
  resourceDownload(@Param('id', ParseIntPipe) id: number) {
    return this.admin.resourceDownload(id);
  }

  // ---------- preguntas
  @Post('lessons/:id/questions')
  addQuestion(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.admin.addQuestion(id, body ?? {});
  }

  @Patch('lessons/:id/questions/order')
  reorderQuestions(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.admin.reorderQuestions(id, body?.ids);
  }

  @Put('questions/:id')
  updateQuestion(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.admin.updateQuestion(id, body ?? {});
  }

  @Delete('questions/:id')
  removeQuestion(@Param('id', ParseIntPipe) id: number) {
    return this.admin.removeQuestion(id);
  }

  // ---------- subidas
  @Post('uploads')
  upload(@Body() body: any) {
    return this.admin.signUpload(body ?? {});
  }

  // ---------- alumnos
  @Get('courses/:id/enrollments')
  enrollments(@Param('id', ParseIntPipe) id: number) {
    return this.admin.enrollments(id);
  }

  @Post('courses/:id/enrollments')
  enroll(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.admin.enrollManual(id, body?.email);
  }

  @Patch('enrollments/:id')
  setEnrollment(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.admin.setEnrollmentStatus(id, body?.status);
  }

  // ---------- entregas
  @Get('submissions')
  submissions(@Query('status') status?: string) {
    return this.admin.submissions(status);
  }

  @Get('submissions/:id/download')
  submissionDownload(@Param('id', ParseIntPipe) id: number) {
    return this.admin.submissionDownload(id);
  }

  @Patch('submissions/:id')
  review(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.admin.review(id, body ?? {});
  }

  // ---------- certificados
  @Get('certificates')
  certificates(@Query('q') q?: string) {
    return this.admin.certificates(q);
  }

  @Patch('certificates/:id')
  revoke(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.admin.revokeCertificate(id, body?.reason, body?.revoked !== false);
  }
}
