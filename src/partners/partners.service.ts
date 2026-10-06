import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePartnerInquiryDto } from './dto/create-partner-inquiry.dto';

@Injectable()
export class PartnersService {
  constructor(private readonly prisma: PrismaService) {}

  async createInquiry(dto: CreatePartnerInquiryDto): Promise<{
    success: true;
    status: 'success';
    message: string;
  }> {
    await this.prisma.partnerInquiry.create({
      data: {
        brandName: dto.brand_name.trim(),
        contactName: dto.contact_name.trim(),
        email: dto.email.trim().toLowerCase(),
        phone: dto.phone.trim(),
        partnershipType: dto.partnership_type.trim(),
        message: dto.message.trim(),
      },
    });

    return {
      success: true,
      status: 'success',
      message: 'Partner inquiry received. Our team will contact you shortly.',
    };
  }

  async listInquiries() {
    const inquiries = await this.prisma.partnerInquiry.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return inquiries.map((inquiry) => ({
      id: inquiry.id,
      brand_name: inquiry.brandName,
      contact_name: inquiry.contactName,
      email: inquiry.email,
      phone: inquiry.phone,
      partnership_type: inquiry.partnershipType,
      message: inquiry.message,
      created_at: inquiry.createdAt,
    }));
  }
}
