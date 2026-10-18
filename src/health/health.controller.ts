import { Controller, Get, Header } from '@nestjs/common';

// GET /health (y HEAD) -> la API está viva. Lo consulta un monitor externo (UptimeRobot) cada 5 min
// para que Render free no la duerma, y el sitio al mostrar páginas sin catálogo.
// No toca la base a propósito: Neon free tiene horas de cómputo limitadas y tiene que poder dormirse.
@Controller('health')
export class HealthController {
  @Get()
  @Header('Cache-Control', 'no-store')
  check() {
    return { ok: true, uptimeS: Math.round(process.uptime()) };
  }
}
