import { Body, Controller, Get, Header, Ip, Param, ParseIntPipe, Post, Req, Res, UseGuards } from '@nestjs/common';
import { CustomerGuard } from '../customers/customer.guard';
import { RateLimiter } from '../common/rate-limit';
import { CoursesService } from './courses.service';

/* Cursos: catálogo y verificación (públicos) y aula del alumno (CustomerGuard). */
@Controller()
export class CoursesController {
  private enrollLimiter = new RateLimiter(20, 60 * 60 * 1000, 'Demasiados intentos seguidos. Probá en un rato.');
  private attemptLimiter = new RateLimiter(60, 60 * 60 * 1000, 'Demasiados intentos seguidos. Probá en un rato.');
  private uploadLimiter = new RateLimiter(30, 60 * 60 * 1000, 'Demasiadas subidas seguidas. Probá en un rato.');

  constructor(private readonly courses: CoursesService) {}

  // ---------- público

  @Get('courses')
  catalog() {
    return this.courses.catalog();
  }

  @Get('courses/:slug')
  course(@Param('slug') slug: string) {
    return this.courses.publicCourse(slug);
  }

  @Get('courses/:slug/lessons/:id/preview')
  preview(@Param('slug') slug: string, @Param('id', ParseIntPipe) id: number) {
    return this.courses.previewLesson(slug, id);
  }

  @Get('certificates/:code')
  verify(@Param('code') code: string) {
    return this.courses.verifyCertificate(code);
  }

  @Get('certificates/:code/pdf')
  @Header('Cache-Control', 'private, max-age=300')
  async pdf(@Param('code') code: string, @Res() res: any) {
    const { code: c, bytes } = await this.courses.certificatePdf(code);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="certificado-${c}.pdf"`);
    res.end(Buffer.from(bytes));
  }

  // ---------- alumno

  @Post('courses/:slug/enroll')
  @UseGuards(CustomerGuard)
  enroll(@Req() req: any, @Param('slug') slug: string, @Ip() ip: string) {
    this.enrollLimiter.check(ip);
    return this.courses.enroll(req.customer, slug);
  }

  @Get('me/courses')
  @UseGuards(CustomerGuard)
  mine(@Req() req: any) {
    return this.courses.myCourses(req.customer.id);
  }

  @Get('me/courses/:slug')
  @UseGuards(CustomerGuard)
  classroom(@Req() req: any, @Param('slug') slug: string) {
    return this.courses.classroom(req.customer, slug);
  }

  @Get('me/courses/:slug/lessons/:id')
  @UseGuards(CustomerGuard)
  lesson(@Req() req: any, @Param('slug') slug: string, @Param('id', ParseIntPipe) id: number) {
    return this.courses.lesson(req.customer.id, slug, id);
  }

  @Post('me/courses/:slug/lessons/:id/complete')
  @UseGuards(CustomerGuard)
  complete(@Req() req: any, @Param('slug') slug: string, @Param('id', ParseIntPipe) id: number) {
    return this.courses.complete(req.customer.id, slug, id);
  }

  @Post('me/courses/:slug/lessons/:id/attempts')
  @UseGuards(CustomerGuard)
  attempt(@Req() req: any, @Param('slug') slug: string, @Param('id', ParseIntPipe) id: number, @Body() body: any) {
    this.attemptLimiter.check(String(req.customer.id));
    return this.courses.attempt(req.customer.id, slug, id, body?.answers);
  }

  @Post('me/courses/:slug/lessons/:id/submission/upload-url')
  @UseGuards(CustomerGuard)
  submissionUploadUrl(@Req() req: any, @Param('slug') slug: string, @Param('id', ParseIntPipe) id: number, @Body() body: any, @Ip() ip: string) {
    this.uploadLimiter.check(ip);
    return this.courses.submissionUploadUrl(req.customer.id, slug, id, body ?? {});
  }

  @Post('me/courses/:slug/lessons/:id/submission')
  @UseGuards(CustomerGuard)
  submit(@Req() req: any, @Param('slug') slug: string, @Param('id', ParseIntPipe) id: number, @Body() body: any) {
    this.uploadLimiter.check(String(req.customer.id));
    return this.courses.submit(req.customer, slug, id, body ?? {});
  }

  @Get('me/courses/:slug/resources/:id')
  @UseGuards(CustomerGuard)
  resource(@Req() req: any, @Param('slug') slug: string, @Param('id', ParseIntPipe) id: number) {
    return this.courses.resourceUrl(req.customer.id, slug, id);
  }

  @Post('me/courses/:slug/certificate')
  @UseGuards(CustomerGuard)
  certificate(@Req() req: any, @Param('slug') slug: string, @Body() body: any) {
    return this.courses.issueCertificate(req.customer, slug, body?.name);
  }
}
