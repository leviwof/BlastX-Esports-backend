import { PartnersService } from './partners.service';

describe('PartnersService', () => {
  it('stores a normalized inquiry and returns the success contract', async () => {
    const create = jest.fn().mockResolvedValue({});
    const service = new PartnersService({
      partnerInquiry: { create },
    } as never);

    await expect(
      service.createInquiry({
        brand_name: '  Red Bull India ',
        contact_name: ' Rohan Sharma ',
        email: ' ROHAN@EXAMPLE.COM ',
        phone: ' +91 9876543210 ',
        partnership_type: ' Title Sponsorship ',
        message: ' We would like to discuss sponsorship opportunities. ',
      }),
    ).resolves.toEqual({
      status: 'success',
      message: 'Partner inquiry received. Our team will contact you shortly.',
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        brandName: 'Red Bull India',
        contactName: 'Rohan Sharma',
        email: 'rohan@example.com',
        phone: '+91 9876543210',
        partnershipType: 'Title Sponsorship',
        message: 'We would like to discuss sponsorship opportunities.',
      },
    });
  });
});
