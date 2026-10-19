import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { ContactController } from './contact.controller';

@Module({ imports: [MailModule], controllers: [ContactController] })
export class ContactModule {}
