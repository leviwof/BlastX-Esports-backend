import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PartnerInquiryStatus } from '@prisma/client';
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
      status: inquiry.status,
      created_at: inquiry.createdAt,
    }));
  }

  async updateInquiryStatus(id: string, status: PartnerInquiryStatus) {
    const existing = await this.prisma.partnerInquiry.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Partner inquiry with ID '${id}' not found`);
    }

    const updated = await this.prisma.partnerInquiry.update({
      where: { id },
      data: { status },
    });

    return {
      id: updated.id,
      brand_name: updated.brandName,
      contact_name: updated.contactName,
      email: updated.email,
      phone: updated.phone,
      partnership_type: updated.partnershipType,
      message: updated.message,
      status: updated.status,
      created_at: updated.createdAt,
    };
  }
}
