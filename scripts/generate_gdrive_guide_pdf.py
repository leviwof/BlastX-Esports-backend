import os
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
    KeepTogether,
    HRFlowable,
    PageBreak,
)
from reportlab.pdfgen import canvas

class NumberedCanvas(canvas.Canvas):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_page_number(num_pages)
            super().showPage()
        super().save()

    def draw_page_number(self, page_count):
        self.saveState()
        self.setFont("Helvetica", 8)
        self.setFillColor(colors.HexColor("#6B7280"))
        
        # Header (on pages > 1)
        if self._pageNumber > 1:
            self.drawString(40, 755, "Google Drive API Setup Guide - Automated Video Storage")
            self.setStrokeColor(colors.HexColor("#E5E7EB"))
            self.setLineWidth(0.5)
            self.line(40, 747, 572, 747)
        
        # Footer (on all pages)
        self.setStrokeColor(colors.HexColor("#E5E7EB"))
        self.setLineWidth(0.5)
        self.line(40, 42, 572, 42)
        
        footer_text = "Confidential - System Integration Manual"
        page_str = f"Page {self._pageNumber} of {page_count}"
        self.drawString(40, 30, footer_text)
        self.drawRightString(572, 30, page_str)
        self.restoreState()


def build_pdf(filename):
    doc = SimpleDocTemplate(
        filename,
        pagesize=letter,
        leftMargin=40,
        rightMargin=40,
        topMargin=46,
        bottomMargin=46
    )

    styles = getSampleStyleSheet()
    
    # Custom styles
    title_style = ParagraphStyle(
        'DocTitle',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=18,
        leading=22,
        textColor=colors.HexColor('#0F172A')
    )

    subtitle_style = ParagraphStyle(
        'DocSubtitle',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=9.5,
        leading=14,
        textColor=colors.HexColor('#475569')
    )

    h1_style = ParagraphStyle(
        'SectionH1',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=12,
        leading=16,
        textColor=colors.HexColor('#1E3A8A'),
        spaceBefore=8,
        spaceAfter=4
    )

    bullet_style = ParagraphStyle(
        'StepBullet',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=9,
        leading=13.5,
        textColor=colors.HexColor('#374151')
    )

    bold_bullet_style = ParagraphStyle(
        'BoldBullet',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=9,
        leading=13.5,
        textColor=colors.HexColor('#1E3A8A')
    )

    story = []

    # ================= PAGE 1 =================
    header_data = [
        [
            Paragraph("<b>GOOGLE DRIVE API SETUP GUIDE</b>", title_style),
            Paragraph("<b>TARGET:</b> Client / System Admin<br/><b>USE CASE:</b> Video Storage Automation", subtitle_style)
        ]
    ]
    header_table = Table(header_data, colWidths=[350, 182])
    header_table.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('ALIGN', (1,0), (1,0), 'RIGHT'),
        ('BOTTOMPADDING', (0,0), (-1,-1), 0),
        ('TOPPADDING', (0,0), (-1,-1), 0),
    ]))
    story.append(header_table)
    story.append(Spacer(1, 6))

    desc_text = "This guide outlines the step-by-step instructions required to authorize the backend server to automatically upload tournament match recordings directly to your designated Google Drive folder."
    story.append(Paragraph(desc_text, subtitle_style))
    story.append(Spacer(1, 8))
    story.append(HRFlowable(width="100%", thickness=1.5, color=colors.HexColor('#2563EB'), spaceAfter=10))

    # --- STEP 1 ---
    step1_title = Paragraph("<b>STEP 1: Create a Google Cloud Project &amp; Enable Google Drive API</b>", h1_style)
    step1_content = [
        [Paragraph("1.", bold_bullet_style), Paragraph("Open your browser and navigate to the <b>Google Cloud Console</b> (<font color='#2563EB'><u>https://console.cloud.google.com/</u></font>).", bullet_style)],
        [Paragraph("2.", bold_bullet_style), Paragraph("Sign in with your business Google / Google Workspace administrator account.", bullet_style)],
        [Paragraph("3.", bold_bullet_style), Paragraph("Click the <b>Project dropdown</b> in the top navigation bar and select <b>New Project</b>.", bullet_style)],
        [Paragraph("4.", bold_bullet_style), Paragraph("Enter a project name (e.g. <b>BlastX-Recordings</b>) and click <b>Create</b>.", bullet_style)],
        [Paragraph("5.", bold_bullet_style), Paragraph("Once creation completes, select the new project from the top dropdown to make it active.", bullet_style)],
        [Paragraph("6.", bold_bullet_style), Paragraph("Open the main navigation menu (top-left) and go to <b>APIs &amp; Services &gt; Library</b>.", bullet_style)],
        [Paragraph("7.", bold_bullet_style), Paragraph("Type <b>Google Drive API</b> into the search field, click on the result, and click the blue <b>ENABLE</b> button.", bullet_style)],
    ]
    t1 = Table(step1_content, colWidths=[20, 512])
    t1.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
        ('TOPPADDING', (0,0), (-1,-1), 3),
        ('LEFTPADDING', (0,0), (-1,-1), 0),
        ('RIGHTPADDING', (0,0), (-1,-1), 0),
    ]))
    story.append(step1_title)
    story.append(t1)
    story.append(Spacer(1, 12))

    # --- STEP 2 ---
    step2_title = Paragraph("<b>STEP 2: Create a Service Account &amp; Download JSON Credentials</b>", h1_style)
    step2_content = [
        [Paragraph("1.", bold_bullet_style), Paragraph("In the navigation menu, go to <b>APIs &amp; Services &gt; Credentials</b> (or <b>IAM &amp; Admin &gt; Service Accounts</b>).", bullet_style)],
        [Paragraph("2.", bold_bullet_style), Paragraph("Click <b>+ CREATE CREDENTIALS</b> at the top of the screen and choose <b>Service Account</b>.", bullet_style)],
        [Paragraph("3.", bold_bullet_style), Paragraph("Enter a name in the <b>Service account name</b> field (e.g. <b>gdrive-video-uploader</b>) and click <b>CREATE AND CONTINUE</b>.", bullet_style)],
        [Paragraph("4.", bold_bullet_style), Paragraph("The role assignment step is optional for Drive folder access - simply click <b>DONE</b>.", bullet_style)],
        [Paragraph("5.", bold_bullet_style), Paragraph("In the Service Accounts list, locate your newly created account and click its name to open details.", bullet_style)],
        [Paragraph("6.", bold_bullet_style), Paragraph("Select the <b>KEYS</b> tab located in the top tab bar.", bullet_style)],
        [Paragraph("7.", bold_bullet_style), Paragraph("Click <b>ADD KEY &gt; Create new key</b>.", bullet_style)],
        [Paragraph("8.", bold_bullet_style), Paragraph("Select <b>JSON</b> as the key type and click <b>CREATE</b>.", bullet_style)],
        [Paragraph("9.", bold_bullet_style), Paragraph("A <b>.json</b> credentials file will immediately download to your computer. Store this file securely.", bullet_style)],
    ]
    t2 = Table(step2_content, colWidths=[20, 512])
    t2.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
        ('TOPPADDING', (0,0), (-1,-1), 3),
        ('LEFTPADDING', (0,0), (-1,-1), 0),
        ('RIGHTPADDING', (0,0), (-1,-1), 0),
    ]))
    story.append(step2_title)
    story.append(t2)

    # Force clean page break so Page 2 contains Step 3 + Checklist + Notices
    story.append(PageBreak())

    # ================= PAGE 2 =================
    story.append(Spacer(1, 10))

    # --- STEP 3 ---
    step3_title = Paragraph("<b>STEP 3: Create Target Folder in Google Drive &amp; Grant Access</b>", h1_style)
    step3_content = [
        [Paragraph("1.", bold_bullet_style), Paragraph("Open <b>Google Drive</b> (<font color='#2563EB'><u>https://drive.google.com/</u></font>) under the Google account where videos will be stored.", bullet_style)],
        [Paragraph("2.", bold_bullet_style), Paragraph("Create a new folder specifically for video uploads (e.g. <b>Match_Recordings</b>).", bullet_style)],
        [Paragraph("3.", bold_bullet_style), Paragraph("Double-click to open the folder and copy the <b>Folder ID</b> from your browser's address bar:<br/>"
                                                "<font color='#475569'>URL pattern: https://drive.google.com/drive/folders/<b>1a2B3c4D5e6F_EXAMPLE_FOLDER_ID</b></font>", bullet_style)],
        [Paragraph("4.", bold_bullet_style), Paragraph("Right-click on the folder name (or click the folder header dropdown) and select <b>Share</b>.", bullet_style)],
        [Paragraph("5.", bold_bullet_style), Paragraph("Open your downloaded <b>.json</b> file with any text editor (Notepad, VS Code) and copy the value of <b>client_email</b>.<br/>"
                                                "<i>Example: gdrive-video-uploader@blastx-recordings.iam.gserviceaccount.com</i>", bullet_style)],
        [Paragraph("6.", bold_bullet_style), Paragraph("Paste this email address into the <b>Add people and groups</b> field in the Share modal.", bullet_style)],
        [Paragraph("7.", bold_bullet_style), Paragraph("Ensure the permission role is set to <b>Editor</b>, uncheck the <b>Notify people</b> checkbox (service accounts have no inbox), and click <b>Share</b>.", bullet_style)],
    ]
    t3 = Table(step3_content, colWidths=[20, 512])
    t3.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
        ('TOPPADDING', (0,0), (-1,-1), 3),
        ('LEFTPADDING', (0,0), (-1,-1), 0),
        ('RIGHTPADDING', (0,0), (-1,-1), 0),
    ]))
    story.append(step3_title)
    story.append(t3)
    story.append(Spacer(1, 14))

    # --- SUMMARY CHECKLIST BOX ---
    checklist_title = ParagraphStyle(
        'ChecklistTitle',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=10.5,
        leading=14,
        textColor=colors.HexColor('#065F46')
    )
    checklist_item = ParagraphStyle(
        'ChecklistItem',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=9,
        leading=14,
        textColor=colors.HexColor('#064E3B')
    )

    box_data = [
        [
            Paragraph("<b>CHECKLIST: DELIVERABLES TO SEND TO THE DEVELOPER</b>", checklist_title)
        ],
        [
            Paragraph("Please provide the developer with only the following 2 items upon completing the setup:<br/><br/>"
                      "<b>[  ]  1. Service Account JSON Key File:</b> The downloaded .json credentials file from Step 2.<br/>"
                      "<b>[  ]  2. Target Folder ID:</b> The alphanumeric string copied from your folder URL in Step 3.", checklist_item)
        ]
    ]
    box_table = Table(box_data, colWidths=[532])
    box_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#ECFDF5')),
        ('BOX', (0,0), (-1,-1), 1, colors.HexColor('#6EE7B7')),
        ('TOPPADDING', (0,0), (-1,-1), 8),
        ('BOTTOMPADDING', (0,0), (-1,-1), 8),
        ('LEFTPADDING', (0,0), (-1,-1), 12),
        ('RIGHTPADDING', (0,0), (-1,-1), 12),
    ]))
    story.append(KeepTogether([box_table]))
    story.append(Spacer(1, 12))

    # --- STORAGE & SECURITY NOTICE ---
    notice_title = ParagraphStyle(
        'NoticeTitle',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=10,
        leading=13,
        textColor=colors.HexColor('#92400E')
    )
    notice_item = ParagraphStyle(
        'NoticeItem',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=8.5,
        leading=13,
        textColor=colors.HexColor('#78350F')
    )

    notice_data = [
        [
            Paragraph("<b>IMPORTANT NOTICES: STORAGE QUOTA &amp; SECURITY</b>", notice_title)
        ],
        [
            Paragraph("<b>- Storage Capacity:</b> Video recordings consume substantial disk space. Standard personal @gmail.com accounts only include 15 GB of shared storage. It is strongly recommended to use a <b>Google Workspace</b> account or subscribe to a <b>Google One</b> storage plan for the destination Drive.<br/>"
                      "<b>- Credential Confidentiality:</b> The Service Account JSON file grants programmatic upload privileges. Transmit it via a private secure channel (e.g. encrypted zip or direct private message) and never commit it to public code repositories.", notice_item)
        ]
    ]
    notice_table = Table(notice_data, colWidths=[532])
    notice_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#FFFBEB')),
        ('BOX', (0,0), (-1,-1), 1, colors.HexColor('#FCD34D')),
        ('TOPPADDING', (0,0), (-1,-1), 7),
        ('BOTTOMPADDING', (0,0), (-1,-1), 7),
        ('LEFTPADDING', (0,0), (-1,-1), 12),
        ('RIGHTPADDING', (0,0), (-1,-1), 12),
    ]))
    story.append(KeepTogether([notice_table]))

    doc.build(story, canvasmaker=NumberedCanvas)
    print(f"PDF successfully built: {filename}")

if __name__ == '__main__':
    output_path = os.path.join(os.getcwd(), "Google_Drive_API_Setup_Guide.pdf")
    build_pdf(output_path)

