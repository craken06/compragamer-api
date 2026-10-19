import { Module } from '@nestjs/common';
import { MailClient } from './mail.client';
import { MailService } from './mail.service';

@Module({ providers: [MailClient, MailService], exports: [MailService] })
export class MailModule {}
