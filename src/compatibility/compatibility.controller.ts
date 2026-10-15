import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Put, UseGuards } from '@nestjs/common';
import { AdminKeyGuard } from '../common/admin-key.guard';
import { CompatibilityService, EvaluateRequest } from './compatibility.service';
import { Rule } from './engine';

@Controller()
export class CompatibilityController {
  constructor(private readonly compatibility: CompatibilityService) {}

  // GET /compatibility/rules -> parámetros (temperatura de diseño, márgenes) y reglas activas
  @Get('compatibility/rules')
  rules() {
    return this.compatibility.getPublicRules();
  }

  // POST /compatibility/evaluate -> veredicto por opción (inversores, baterías, cables/protecciones)
  // Sólo lee la base: evalúa con los datos guardados, no con specs que mande el cliente.
  @Post('compatibility/evaluate')
  @HttpCode(200)
  evaluate(@Body() body: EvaluateRequest) {
    return this.compatibility.evaluate(body);
  }

  // --- Administración: reglas como datos (tabla compatibility_rules) ---
  @Get('admin/compatibility-rules')
  @UseGuards(AdminKeyGuard)
  list() {
    return this.compatibility.listAll();
  }

  @Post('admin/compatibility-rules')
  @UseGuards(AdminKeyGuard)
  create(@Body() body: Partial<Rule>) {
    return this.compatibility.upsert(null, body);
  }

  @Put('admin/compatibility-rules/:id')
  @UseGuards(AdminKeyGuard)
  update(@Param('id', ParseIntPipe) id: number, @Body() body: Partial<Rule>) {
    return this.compatibility.upsert(id, body);
  }
}
